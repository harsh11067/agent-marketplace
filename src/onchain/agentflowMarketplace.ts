import { Contract, JsonRpcProvider, Wallet } from "ethers";

const marketplaceAbi = [
  "function postJob(string taskURI, uint256 budget, uint256 deadline) returns (uint256 jobId)",
  "function submitBid(uint256 jobId, uint256 price, string metadataURI)",
  "function assignJob(uint256 jobId, address winner, uint256 agreedPrice)",
  "function completeJob(uint256 jobId, string resultURI)",
  "function getBids(uint256 jobId) view returns (tuple(address agent,uint256 price,string metadataURI,uint256 submittedAt)[])",
  "function jobs(uint256 jobId) view returns (tuple(address poster,string taskURI,uint256 budget,uint256 deadline,address winner,uint256 agreedPrice,uint8 status,string resultURI))"
] as const;

const erc20Abi = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)"
] as const;

export type AgentflowOnchainConfig = {
  rpcUrl: string;
  marketplaceAddress: string;
  usdcAddress: string;
  reputationAddress?: string;
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
    usdcAddress: process.env.AGENTFLOW_USDC_ADDRESS ?? process.env.USDC_ADDRESS ?? "",
    orchestratorKey: process.env.AGENT_OWNER_KEY ?? "",
    builderKey: process.env.AGENT_BUILDER_KEY ?? "",
    designKey: process.env.AGENT_DESIGN_KEY ?? ""
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
  const token = new Contract(params.usdcAddress, erc20Abi, wallet);
  const current: bigint = await token.allowance(wallet.address, params.spender);
  if (current >= params.minAmount) {
    return { approved: false, allowance: current };
  }
  const tx = await token.approve(params.spender, params.minAmount);
  await tx.wait();
  const next: bigint = await token.allowance(wallet.address, params.spender);
  return { approved: true, txHash: tx.hash, allowance: next };
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
