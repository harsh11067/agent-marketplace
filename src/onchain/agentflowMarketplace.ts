import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { delegationBudgetAbi, erc20Abi as sharedErc20Abi } from "../shared/contracts.ts";
import { deriveAddressFromPrivateKey } from "../shared/wallet.ts";

const marketplaceAbi = [
  "function postJob(string taskURI, uint256 budget, uint256 deadline) returns (uint256 jobId)",
  "function submitBid(uint256 jobId, uint256 price, string metadataURI)",
  "function assignJob(uint256 jobId, address winner, uint256 agreedPrice)",
  "function completeJob(uint256 jobId, string resultURI)",
  "function jobCount() view returns (uint256)",
  "function getBids(uint256 jobId) view returns (tuple(address agent,uint256 price,string metadataURI,uint256 submittedAt)[])",
  "function jobs(uint256 jobId) view returns (tuple(address poster,string taskURI,uint256 budget,uint256 deadline,address winner,uint256 agreedPrice,uint8 status,string resultURI))"
] as const;

export type AgentflowOnchainConfig = {
  rpcUrl: string;
  marketplaceAddress: string;
  usdcAddress: string;
  reputationAddress?: string;
  delegationBudgetAddress?: string;
  deployerKey?: string;
  orchestratorKey?: string;
  builderKey?: string;
  designKey?: string;
};

function getProvider(rpcUrl: string) {
  return new JsonRpcProvider(rpcUrl);
}

function getWallet(privateKey: string | undefined, provider: JsonRpcProvider) {
  if (!privateKey) return undefined;
  return new Wallet(privateKey, provider);
}

export function isOnchainEnabled(config: Partial<AgentflowOnchainConfig>): config is AgentflowOnchainConfig {
  return Boolean(config.rpcUrl && config.marketplaceAddress && config.usdcAddress);
}

export function loadOnchainConfigFromEnv(): Partial<AgentflowOnchainConfig> {
  return {
    rpcUrl: process.env.BASE_SEPOLIA_RPC ?? process.env.SEPOLIA_RPC_URL ?? "",
    marketplaceAddress: process.env.AGENTFLOW_MARKETPLACE_ADDRESS ?? "",
    reputationAddress: process.env.AGENTFLOW_REPUTATION_ADDRESS ?? "",
    delegationBudgetAddress: process.env.AGENTFLOW_DELEGATION_BUDGET_ADDRESS ?? "",
    usdcAddress: process.env.AGENTFLOW_USDC_ADDRESS ?? process.env.USDC_ADDRESS ?? "",
    deployerKey: process.env.DEPLOYER_KEY ?? "",
    orchestratorKey: process.env.AGENT_OWNER_KEY ?? "",
    builderKey: process.env.AGENT_BUILDER_KEY ?? "",
    designKey: process.env.AGENT_DESIGN_KEY ?? ""
  };
}

export function deriveManagedAddresses(config: Partial<AgentflowOnchainConfig>) {
  return {
    orchestratorAddress: deriveAddressFromPrivateKey(config.orchestratorKey),
    builderAddress: deriveAddressFromPrivateKey(config.builderKey),
    designAddress: deriveAddressFromPrivateKey(config.designKey)
  };
}

export async function approveUsdcIfNeeded(params: {
  rpcUrl: string;
  usdcAddress: string;
  spender: string;
  ownerKey: string;
  minAmount: bigint;
}): Promise<{ approved: boolean; txHash?: string; allowance: bigint }> {
  const provider = getProvider(params.rpcUrl);
  const wallet = getWallet(params.ownerKey, provider);
  if (!wallet) {
    throw new Error("missing ownerKey");
  }
  const token = new Contract(params.usdcAddress, sharedErc20Abi, wallet);
  const current: bigint = await token.allowance(wallet.address, params.spender);
  if (current >= params.minAmount) {
    return { approved: false, allowance: current };
  }
  const tx = await token.approve(params.spender, params.minAmount);
  await tx.wait();
  const next: bigint = await token.allowance(wallet.address, params.spender);
  return { approved: true, txHash: tx.hash, allowance: next };
}

export async function getUsdcBalance(params: {
  rpcUrl: string;
  usdcAddress: string;
  address: string;
}): Promise<bigint> {
  const provider = getProvider(params.rpcUrl);
  const token = new Contract(params.usdcAddress, sharedErc20Abi, provider);
  return (await token.balanceOf(params.address)) as bigint;
}

export async function transferUsdc(params: {
  rpcUrl: string;
  usdcAddress: string;
  fromKey: string;
  to: string;
  amount: bigint;
}): Promise<{ txHash: string }> {
  const provider = getProvider(params.rpcUrl);
  const wallet = getWallet(params.fromKey, provider);
  if (!wallet) {
    throw new Error("missing fromKey");
  }
  const token = new Contract(
    params.usdcAddress,
    [...sharedErc20Abi, "function transfer(address to, uint256 amount) returns (bool)"] as const,
    wallet
  );
  const tx = await token.transfer(params.to, params.amount);
  await tx.wait();
  return { txHash: tx.hash };
}

export async function registerDelegationOnchain(params: {
  rpcUrl: string;
  delegationBudgetAddress: string;
  actorKey: string;
  delegationHash: string;
  delegator: string;
  delegate: string;
  cap: bigint;
  deadlineUnix: number;
}): Promise<{ txHash: string }> {
  const provider = getProvider(params.rpcUrl);
  const wallet = getWallet(params.actorKey, provider);
  if (!wallet) {
    throw new Error("missing actorKey");
  }
  const budget = new Contract(params.delegationBudgetAddress, delegationBudgetAbi, wallet);
  const tx = await budget.registerDelegation(
    params.delegationHash,
    params.delegator,
    params.delegate,
    params.cap,
    BigInt(params.deadlineUnix)
  );
  await tx.wait();
  return { txHash: tx.hash };
}

export async function recordDelegationSpendOnchain(params: {
  rpcUrl: string;
  delegationBudgetAddress: string;
  delegateKey: string;
  delegationHash: string;
  amount: bigint;
}): Promise<{ txHash: string }> {
  const provider = getProvider(params.rpcUrl);
  const wallet = getWallet(params.delegateKey, provider);
  if (!wallet) {
    throw new Error("missing delegateKey");
  }
  const budget = new Contract(params.delegationBudgetAddress, delegationBudgetAbi, wallet);
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const tx = await budget.recordSpend(params.delegationHash, params.amount);
      await tx.wait();
      return { txHash: tx.hash };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Delegation inactive") || attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function postJobOnchain(params: {
  rpcUrl: string;
  marketplaceAddress: string;
  orchestratorKey: string;
  taskURI: string;
  budgetUsdc6: bigint;
  deadlineUnix: number;
}): Promise<{ jobId: number; txHash: string }> {
  const provider = getProvider(params.rpcUrl);
  const wallet = getWallet(params.orchestratorKey, provider);
  if (!wallet) {
    throw new Error("missing orchestratorKey");
  }
  const marketplace = new Contract(params.marketplaceAddress, marketplaceAbi, wallet);
  const tx = await marketplace.postJob(params.taskURI, params.budgetUsdc6, BigInt(params.deadlineUnix));
  const receipt = await tx.wait();

  // Try to extract JobPosted(jobId, ...) from logs (Hardhat/ethers v6 event parsing can vary),
  // but return 0 if it cannot be parsed reliably.
  let jobId = 0;
  try {
    const parsed = receipt?.logs
      ?.map((log: any) => {
        try {
          return marketplace.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const event = parsed?.find((item: any) => item?.name === "JobPosted");
    jobId = event?.args?.jobId ? Number(event.args.jobId) : 0;
  } catch {
    jobId = 0;
  }

  if (!jobId) {
    try {
      jobId = Number(await marketplace.jobCount());
    } catch {
      jobId = 0;
    }
  }

  return { jobId, txHash: tx.hash };
}

export async function submitBidOnchain(params: {
  rpcUrl: string;
  marketplaceAddress: string;
  agentKey: string;
  jobId: number;
  priceUsdc6: bigint;
  metadataURI: string;
}): Promise<{ txHash: string }> {
  const provider = getProvider(params.rpcUrl);
  const wallet = getWallet(params.agentKey, provider);
  if (!wallet) {
    throw new Error("missing agentKey");
  }
  const marketplace = new Contract(params.marketplaceAddress, marketplaceAbi, wallet);
  const tx = await marketplace.submitBid(BigInt(params.jobId), params.priceUsdc6, params.metadataURI);
  await tx.wait();
  return { txHash: tx.hash };
}

export async function assignJobOnchain(params: {
  rpcUrl: string;
  marketplaceAddress: string;
  orchestratorKey: string;
  jobId: number;
  winnerAddress: string;
  agreedPriceUsdc6: bigint;
}): Promise<{ txHash: string }> {
  const provider = getProvider(params.rpcUrl);
  const wallet = getWallet(params.orchestratorKey, provider);
  if (!wallet) {
    throw new Error("missing orchestratorKey");
  }
  const marketplace = new Contract(params.marketplaceAddress, marketplaceAbi, wallet);
  const tx = await marketplace.assignJob(BigInt(params.jobId), params.winnerAddress, params.agreedPriceUsdc6);
  await tx.wait();
  return { txHash: tx.hash };
}

export async function completeJobOnchain(params: {
  rpcUrl: string;
  marketplaceAddress: string;
  agentKey: string;
  jobId: number;
  resultURI: string;
}): Promise<{ txHash: string }> {
  const provider = getProvider(params.rpcUrl);
  const wallet = getWallet(params.agentKey, provider);
  if (!wallet) {
    throw new Error("missing agentKey");
  }
  const marketplace = new Contract(params.marketplaceAddress, marketplaceAbi, wallet);
  const tx = await marketplace.completeJob(BigInt(params.jobId), params.resultURI);
  await tx.wait();
  return { txHash: tx.hash };
}
