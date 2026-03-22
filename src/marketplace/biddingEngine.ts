import type { AgentProfile, Bid, Task } from "../types.ts";
import { ReputationStore } from "./reputation.ts";

export class BiddingEngine {
  private readonly reputationStore: ReputationStore;

  constructor(reputationStore: ReputationStore) {
    this.reputationStore = reputationStore;
  }

  createBid(task: Task, agent: AgentProfile): Bid {
    const matches = task.requirements.filter((requirement) =>
      agent.capabilities.includes(requirement)
    ).length;
    const coverage = Math.max(1, task.requirements.length);
    const capabilityScore = Math.round((matches / coverage) * 100);
    const desiredPrice = Math.max(agent.minPrice, task.reward - capabilityScore / 4);
    const price = Math.max(1, Math.min(task.reward, desiredPrice));

    const bid = {
      id: `bid-${task.id}-${agent.id}`,
      taskId: task.id,
      agentId: agent.id,
      price: Math.round(price),
      capabilityScore,
      reputationScore: this.reputationStore.get(agent.id),
      rationale: `${agent.name} covers ${matches}/${coverage} required capabilities.`,
      createdAt: Date.now()
    };

    console.log(
      `[bid:create] ${bid.id} task=${task.id} agent=${agent.id} reputation=${bid.reputationScore}`
    );

    return bid;
  }
}
