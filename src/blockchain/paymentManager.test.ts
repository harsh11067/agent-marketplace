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
