import { Contract, formatUnits } from "ethers";
import { erc20Abi } from "../src/shared/contracts.ts";
import { createWallet } from "../src/shared/wallet.ts";

async function main(): Promise<void> {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC ?? "";
  const privateKey = process.env.DEPLOYER_KEY ?? process.env.AGENT_OWNER_KEY ?? "";
  const usdcAddress = process.env.AGENTFLOW_USDC_ADDRESS ?? "";
  const recipients = [
    process.env.AGENT_OWNER_WALLET ?? "",
    process.env.AGENT_BUILDER_WALLET ?? "",
    process.env.AGENT_DESIGN_WALLET ?? ""
  ].filter(Boolean);

  if (!rpcUrl || !privateKey || !usdcAddress) {
    throw new Error("Missing BASE_SEPOLIA_RPC, signer key, or AGENTFLOW_USDC_ADDRESS");
  }

  const wallet = createWallet(privateKey, rpcUrl);
  const usdc = new Contract(usdcAddress, erc20Abi, wallet);

  for (const recipient of recipients) {
    const balance = await usdc.balanceOf(recipient);
    console.log(`[fundAgents] recipient=${recipient} balance=${formatUnits(balance, 6)} USDC`);
  }
}

void main().catch((error) => {
  console.error(`[fundAgents] failed ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
