export class ReputationStore {
  private readonly scores = new Map<string, number>();

  set(agentId: string, score: number): void {
    this.scores.set(agentId, score);
  }

  get(agentId: string): number {
    return this.scores.get(agentId) ?? 50;
  }

  reward(agentId: string, amount = 5): void {
    this.scores.set(agentId, Math.min(100, this.get(agentId) + amount));
  }
}
