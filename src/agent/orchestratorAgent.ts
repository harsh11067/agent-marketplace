import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { createIpfsUploaderFromEnv, type IpfsJsonUploader } from "../onchain/ipfs.ts";

const marketplaceAbi = [
  "function postJob(string taskURI, uint256 budget, uint256 deadline) returns (uint256 jobId)",
  "function getBids(uint256 jobId) view returns (tuple(address agent,uint256 price,string metadataURI,uint256 submittedAt)[])",
  "function assignJob(uint256 jobId, address winner, uint256 agreedPrice)",
  "function jobCount() view returns (uint256)"
] as const;

const erc20Abi = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
] as const;

type Logger = (line: string) => void;

export type OrchestratorTaskInput = {
  title: string;
  description: string;
  budgetUsdc6: bigint;
  deadlineUnix: number;
  tags?: string[];
};

export type RankedBid = {
  agent: string;
  price: bigint;
  metadataURI: string;
  submittedAt: bigint;
};

export type OrchestratorRunResult = {
  jobId: number;
  taskURI: string;
  bidsSeen: number;
  selectedWinner: string;
  selectedPrice: bigint;
  postTxHash: string;
  assignTxHash: string;
};

export type OnchainOrchestratorConfig = {
  rpcUrl: string;
  marketplaceAddress: string;
  usdcAddress: string;
  orchestratorKey: string;
  bidPollIntervalMs?: number;
  bidPollTimeoutMs?: number;
  minBids?: number;
  ipfsUploader?: IpfsJsonUploader;
  logger?: Logger;
};

type MarketplaceLike = {
  postJob: (taskURI: string, budget: bigint, deadline: bigint) => Promise<{ hash: string; wait: () => Promise<unknown> }>;
  getBids: (jobId: bigint) => Promise<unknown[]>;
  assignJob: (jobId: bigint, winner: string, agreedPrice: bigint) => Promise<{ hash: string; wait: () => Promise<unknown> }>;
  jobCount: () => Promise<bigint>;
};

type UsdcLike = {
  approve: (spender: string, amount: bigint) => Promise<{ hash: string; wait: () => Promise<unknown> }>;
  allowance: (owner: string, spender: string) => Promise<bigint>;
};

export class OrchestratorAgent {
  private readonly marketplace: MarketplaceLike;
  private readonly usdc: UsdcLike;
  private readonly posterAddress: string;
  private readonly marketplaceAddress: string;
  private readonly uploader: IpfsJsonUploader;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  private readonly minBids: number;
  private readonly log: Logger;

  constructor(params: {
    marketplace: MarketplaceLike;
    usdc: UsdcLike;
    posterAddress: string;
    marketplaceAddress: string;
    uploader: IpfsJsonUploader;
    pollIntervalMs?: number;
    pollTimeoutMs?: number;
    minBids?: number;
    logger?: Logger;
  }) {
    this.marketplace = params.marketplace;
    this.usdc = params.usdc;
    this.posterAddress = params.posterAddress;
    this.marketplaceAddress = params.marketplaceAddress;
    this.uploader = params.uploader;
    this.pollIntervalMs = params.pollIntervalMs ?? 5_000;
    this.pollTimeoutMs = params.pollTimeoutMs ?? 30_000;
    this.minBids = Math.max(1, params.minBids ?? 1);
    this.log = params.logger ?? ((line) => console.log(line));
  }

  static fromConfig(config: OnchainOrchestratorConfig): OrchestratorAgent {
    const provider = new JsonRpcProvider(config.rpcUrl);
    const wallet = new Wallet(config.orchestratorKey, provider);
    const marketplace = new Contract(config.marketplaceAddress, marketplaceAbi, wallet);
    const usdc = new Contract(config.usdcAddress, erc20Abi, wallet);

    return new OrchestratorAgent({
      marketplace: marketplace as unknown as MarketplaceLike,
      usdc: usdc as unknown as UsdcLike,
      posterAddress: wallet.address,
      marketplaceAddress: config.marketplaceAddress,
      uploader: config.ipfsUploader ?? createIpfsUploaderFromEnv(),
      pollIntervalMs: config.bidPollIntervalMs,
      pollTimeoutMs: config.bidPollTimeoutMs,
      minBids: config.minBids,
      logger: config.logger
    });
  }

  createTaskMetadata(input: OrchestratorTaskInput): Record<string, unknown> {
    const metadata = {
      version: "1",
      kind: "agentflow-task",
      createdAt: new Date().toISOString(),
      poster: this.posterAddress,
      title: input.title,
      description: input.description,
      budgetUsdc6: input.budgetUsdc6.toString(),
      deadlineUnix: input.deadlineUnix,
      tags: input.tags ?? []
    };
    this.log(`[orchestrator] metadata: created title="${input.title}" budget=${input.budgetUsdc6.toString()}`);
    return metadata;
  }

  async run(input: OrchestratorTaskInput): Promise<OrchestratorRunResult> {
    this.log("[orchestrator] step=1 create-task-metadata");
    const metadata = this.createTaskMetadata(input);

    this.log("[orchestrator] step=2 upload-task-metadata-ipfs");
    const uploaded = await this.uploader(metadata);
    this.log(`[orchestrator] ipfs: cid=${uploaded.cid} uri=${uploaded.uri}`);

    this.log("[orchestrator] step=3 approve-usdc-if-needed");
    const currentAllowance = await this.usdc.allowance(this.posterAddress, this.marketplaceAddress);
    if (currentAllowance < input.budgetUsdc6) {
      const approveTx = await this.usdc.approve(this.marketplaceAddress, input.budgetUsdc6);
      await approveTx.wait();
      this.log(`[orchestrator] usdc: approved tx=${approveTx.hash}`);
    } else {
      this.log(`[orchestrator] usdc: approval-skip allowance=${currentAllowance.toString()}`);
    }

    this.log("[orchestrator] step=4 post-job");
    const postTx = await this.marketplace.postJob(uploaded.uri, input.budgetUsdc6, BigInt(input.deadlineUnix));
    await postTx.wait();
    const jobId = Number(await this.marketplace.jobCount());
    this.log(`[orchestrator] post: tx=${postTx.hash} jobId=${jobId}`);

    this.log("[orchestrator] step=5 wait-for-bids");
    const bids = await this.pollForBids(jobId);
    this.log(`[orchestrator] bids: count=${bids.length}`);

    this.log("[orchestrator] step=6 rank-bids-deterministic");
    const ranked = rankBidsDeterministic(bids);
    const winner = ranked[0];
    if (!winner) {
      throw new Error(`No bids received for job ${jobId}`);
    }
    this.log(
      `[orchestrator] winner: agent=${winner.agent} price=${winner.price.toString()} submittedAt=${winner.submittedAt.toString()}`
    );

    this.log("[orchestrator] step=7 assign-winner");
    const assignTx = await this.marketplace.assignJob(BigInt(jobId), winner.agent, winner.price);
    await assignTx.wait();
    this.log(`[orchestrator] assign: tx=${assignTx.hash} winner=${winner.agent} price=${winner.price.toString()}`);

    return {
      jobId,
      taskURI: uploaded.uri,
      bidsSeen: bids.length,
      selectedWinner: winner.agent,
      selectedPrice: winner.price,
      postTxHash: postTx.hash,
      assignTxHash: assignTx.hash
    };
  }

  private async pollForBids(jobId: number): Promise<RankedBid[]> {
    const startedAt = Date.now();
    let iterations = 0;

    while (true) {
      iterations += 1;
      const raw = await this.marketplace.getBids(BigInt(jobId));
      const bids = raw.map(parseBid).filter((bid): bid is RankedBid => bid !== null);

      this.log(`[orchestrator] poll: attempt=${iterations} bids=${bids.length}`);
      if (bids.length >= this.minBids) {
        return bids;
      }
      if (Date.now() - startedAt >= this.pollTimeoutMs) {
        return bids;
      }
      await sleep(this.pollIntervalMs);
    }
  }
}

export function rankBidsDeterministic(bids: RankedBid[]): RankedBid[] {
  return [...bids].sort((left, right) => {
    if (left.price < right.price) return -1;
    if (left.price > right.price) return 1;
    if (left.submittedAt < right.submittedAt) return -1;
    if (left.submittedAt > right.submittedAt) return 1;
    return left.agent.toLowerCase().localeCompare(right.agent.toLowerCase());
  });
}

function parseBid(rawBid: unknown): RankedBid | null {
  const bid = rawBid as {
    agent?: string;
    price?: bigint;
    metadataURI?: string;
    submittedAt?: bigint;
    [k: number]: unknown;
  };

  const agent = typeof bid.agent === "string" ? bid.agent : (bid[0] as string | undefined);
  const price = typeof bid.price === "bigint" ? bid.price : (bid[1] as bigint | undefined);
  const metadataURI = typeof bid.metadataURI === "string" ? bid.metadataURI : (bid[2] as string | undefined);
  const submittedAt = typeof bid.submittedAt === "bigint" ? bid.submittedAt : (bid[3] as bigint | undefined);

  if (!agent || price === undefined || !metadataURI || submittedAt === undefined) {
    return null;
  }

  return { agent, price, metadataURI, submittedAt };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
