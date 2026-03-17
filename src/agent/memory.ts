import type { AgentDecision } from "../types.ts";

export class AgentMemory {
  private readonly decisions: AgentDecision[] = [];

  record(decision: AgentDecision): void {
    this.decisions.push(decision);
  }

  list(agentId?: string): AgentDecision[] {
    if (!agentId) {
      return [...this.decisions];
    }

    return this.decisions.filter((decision) => decision.agentId === agentId);
  }
}
