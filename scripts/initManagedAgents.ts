import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createRandomManagedWallet, deriveAddressFromPrivateKey, transferNativeToken } from "../src/shared/wallet.ts";
import { getUsdcBalance, transferUsdc } from "../src/onchain/agentflowMarketplace.ts";

const envPath = resolve(process.cwd(), ".env");

function upsertEnvValue(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }
  return `${content.trimEnd()}\n${line}\n`;
}

async function main(): Promise<void> {
  let env = await readFile(envPath, "utf8");
  const rpcUrl = process.env.BASE_SEPOLIA_RPC ?? "";
  const usdcTreasuryKey = process.env.DEPLOYER_KEY ?? "";
  const nativeTreasuryKey = process.env.AGENT_OWNER_KEY ?? process.env.DEPLOYER_KEY ?? "";
  const usdcAddress = process.env.AGENTFLOW_USDC_ADDRESS ?? process.env.USDC_ADDRESS ?? "";

  if (!rpcUrl || !usdcTreasuryKey || !nativeTreasuryKey || !usdcAddress) {
    throw new Error("Missing BASE_SEPOLIA_RPC, treasury keys, or AGENTFLOW_USDC_ADDRESS");
  }

  const managed = [
    { key: "AGENT_OWNER_KEY", wallet: "AGENT_OWNER_WALLET", fundUsdc6: 10_000_000n, fundEth: "0" },
    { key: "AGENT_BUILDER_KEY", wallet: "AGENT_BUILDER_WALLET", fundUsdc6: 0n, fundEth: "0.00003" },
    { key: "AGENT_DESIGN_KEY", wallet: "AGENT_DESIGN_WALLET", fundUsdc6: 0n, fundEth: "0.00003" }
  ];

  for (const item of managed) {
    let privateKey = process.env[item.key] ?? "";
    if (!privateKey) {
      const wallet = createRandomManagedWallet();
      privateKey = wallet.privateKey;
      env = upsertEnvValue(env, item.key, privateKey);
      env = upsertEnvValue(env, item.wallet, wallet.address);
      console.log(`[managed] generated ${item.key} ${wallet.address}`);
    } else {
      const address = deriveAddressFromPrivateKey(privateKey);
      env = upsertEnvValue(env, item.wallet, address);
      console.log(`[managed] existing ${item.key} ${address}`);
    }
  }

  await writeFile(envPath, env, "utf8");

  const refreshed = await readFile(envPath, "utf8");
  const envMap = Object.fromEntries(
    refreshed
      .split(/\r?\n/)
      .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );

  for (const item of managed) {
    const address = envMap[item.wallet];
    if (!address) continue;

    if (Number(item.fundEth) > 0) {
      const nativeTx = await transferNativeToken({
        rpcUrl,
        fromKey: nativeTreasuryKey,
        to: address,
        amountEth: item.fundEth
      });
      console.log(`[managed] funded native ${address} tx=${nativeTx}`);
    }

    if (item.fundUsdc6 > 0n) {
      const balance = await getUsdcBalance({ rpcUrl, usdcAddress, address });
      if (balance < item.fundUsdc6) {
        const tx = await transferUsdc({
          rpcUrl,
          usdcAddress,
          fromKey: usdcTreasuryKey,
          to: address,
          amount: item.fundUsdc6 - balance
        });
        console.log(`[managed] funded usdc ${address} tx=${tx.txHash}`);
      }
    }
  }
}

void main().catch((error) => {
  console.error(`[initManagedAgents] failed ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
