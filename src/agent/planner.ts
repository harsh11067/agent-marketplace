import type { Bid, Task, TaskResult } from "../types.ts";

export class Planner {
  createRequirements(taskDescription: string): string[] {
    const keywords = taskDescription
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);

    const inferred = new Set<string>();

    if (keywords.includes("landing") || keywords.includes("page")) {
      inferred.add("frontend");
      inferred.add("copywriting");
    }

    if (keywords.includes("api") || keywords.includes("backend")) {
      inferred.add("backend");
    }

    if (keywords.includes("smart") || keywords.includes("contract")) {
      inferred.add("blockchain");
    }

    if (inferred.size === 0) {
      inferred.add("generalist");
    }

    return [...inferred];
  }

  scoreBid(bid: Bid): number {
    return bid.capabilityScore * 0.45 + bid.reputationScore * 0.35 + (100 - bid.price) * 0.2;
  }

  verifyResult(task: Task, result: TaskResult): boolean {
    return (
      result.summary.length > 0 &&
      result.verificationNotes.length > 0 &&
      result.artifactPath.length > 0 &&
      task.description.length > 0
    );
  }
}
