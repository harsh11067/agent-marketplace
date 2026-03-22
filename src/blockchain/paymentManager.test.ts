import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PaymentManager } from "./paymentManager.ts";
import { MockEscrowContract } from "./escrowContract.ts";
import type { Bid, Task } from "../types.ts";

function sampleTask(): Task {
  return {
    id: "task-test-1",
    createdAt: Date.now(),
    title: "Test",
    description: "Test task",
    reward: 5,
    requirements: ["frontend"],
    createdBy: "agent-owner",
    status: "assigned",
    selectedAgentId: "agent-builder"
  };
}

function sampleBid(): Bid {
  return {
    id: "bid-1",
    taskId: "task-test-1",
    agentId: "agent-builder",
    price: 4,
    capabilityScore: 90,
    reputationScore: 70,
    rationale: "good fit",
    createdAt: Date.now()
  };
}

describe("PaymentManager", () => {
  it("uses local escrow when on-chain mode is enabled but the task was not mirrored on-chain", async () => {
    process.env.DEV_MODE = "false";
    process.env.BASE_SEPOLIA_RPC = "https://example-rpc.test";
    process.env.AGENTFLOW_MARKETPLACE_ADDRESS = "0x1111111111111111111111111111111111111111";
    process.env.AGENTFLOW_USDC_ADDRESS = "0x2222222222222222222222222222222222222222";

    const manager = new PaymentManager(new MockEscrowContract(), {
      "agent-owner": "0xaaaa",
      "agent-builder": "0xbbbb"
    });

    const created = await manager.createEscrow(sampleTask(), sampleBid(), "agent-owner");
    assert.equal(created.escrowId, "escrow-task-test-1");

    delete process.env.BASE_SEPOLIA_RPC;
    delete process.env.AGENTFLOW_MARKETPLACE_ADDRESS;
    delete process.env.AGENTFLOW_USDC_ADDRESS;
  });

  it("fails loudly when wallet is missing and DEV_MODE=false", async () => {
    process.env.DEV_MODE = "false";
    const manager = new PaymentManager(new MockEscrowContract(), {
      "agent-owner": "",
      "agent-builder": ""
    });

    await assert.rejects(
      () => manager.createEscrow(sampleTask(), sampleBid(), "agent-owner"),
      /DEV_MODE=false/
    );
  });

  it("allows explicit fallback only when DEV_MODE=true", async () => {
    process.env.DEV_MODE = "true";
    const manager = new PaymentManager(new MockEscrowContract(), {
      "agent-owner": "",
      "agent-builder": ""
    });

    const created = await manager.createEscrow(sampleTask(), sampleBid(), "agent-owner");
    assert.equal(created.escrowId, "escrow-task-test-1");
  });
});
