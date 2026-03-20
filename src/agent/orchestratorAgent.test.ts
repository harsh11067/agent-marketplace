import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OrchestratorAgent } from "./orchestratorAgent.ts";

class FakeMarketplace {
  public postCalls = 0;
  public getBidsCalls = 0;
  public assignCalls = 0;
  public assignedWinner: string | undefined;
  public assignedPrice: bigint | undefined;
  public readonly bids: Array<{ agent: string; price: bigint; metadataURI: string; submittedAt: bigint }>;

  constructor(bids: Array<{ agent: string; price: bigint; metadataURI: string; submittedAt: bigint }>) {
    this.bids = bids;
  }

  async postJob(): Promise<{ hash: string; wait: () => Promise<void> }> {
    this.postCalls += 1;
    return { hash: "0xpost", wait: async () => undefined };
  }

  async getBids(): Promise<Array<{ agent: string; price: bigint; metadataURI: string; submittedAt: bigint }>> {
    this.getBidsCalls += 1;
    return this.bids;
  }

  async assignJob(_jobId: bigint, winner: string, agreedPrice: bigint): Promise<{ hash: string; wait: () => Promise<void> }> {
    this.assignCalls += 1;
    this.assignedWinner = winner;
    this.assignedPrice = agreedPrice;
    return { hash: "0xassign", wait: async () => undefined };
  }

  async jobCount(): Promise<bigint> {
    return 1n;
  }
}

class FakeUsdc {
  public approveCalls = 0;
  private allowanceValue = 0n;

  async allowance(): Promise<bigint> {
    return this.allowanceValue;
  }

  async approve(_spender: string, amount: bigint): Promise<{ hash: string; wait: () => Promise<void> }> {
    this.approveCalls += 1;
    this.allowanceValue = amount;
    return { hash: "0xapprove", wait: async () => undefined };
  }
}

describe("OrchestratorAgent", () => {
  it("posts, reads bids, and assigns exactly one deterministic winner", async () => {
    const marketplace = new FakeMarketplace([
      { agent: "0xbbb", price: 3_000_000n, metadataURI: "ipfs://b", submittedAt: 12n },
      { agent: "0xaaa", price: 3_000_000n, metadataURI: "ipfs://a", submittedAt: 10n }
    ]);
    const usdc = new FakeUsdc();

    const orchestrator = new OrchestratorAgent({
      marketplace,
      usdc,
      posterAddress: "0xposter",
      marketplaceAddress: "0xmarket",
      uploader: async () => ({ cid: "cid-1", uri: "ipfs://cid-1" }),
      pollIntervalMs: 1,
      pollTimeoutMs: 50,
      minBids: 1,
      logger: () => undefined
    });

    const result = await orchestrator.run({
      title: "Task",
      description: "Ship feature",
      budgetUsdc6: 5_000_000n,
      deadlineUnix: 1_900_000_000
    });

    assert.equal(marketplace.postCalls, 1, "orchestrator should post by itself");
    assert.ok(marketplace.getBidsCalls >= 1, "orchestrator should read bids");
    assert.equal(marketplace.assignCalls, 1, "orchestrator should assign exactly one winner");
    assert.equal(result.selectedWinner, "0xaaa");
    assert.equal(result.selectedPrice, 3_000_000n);
  });
});
