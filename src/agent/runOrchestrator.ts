import { OrchestratorAgent } from "./orchestratorAgent.ts";

function requiredEnv(name: string): string {
  const value = process.env[name] ?? "";
  if (!value) {
    throw new Error(`Missing env ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const deadlineUnix = Number(process.env.ORCH_DEADLINE_UNIX ?? now + 3600);
  const budgetUsdc6 = BigInt(process.env.ORCH_BUDGET_USDC6 ?? "5000000");

  const agent = OrchestratorAgent.fromConfig({
    rpcUrl: requiredEnv("BASE_SEPOLIA_RPC"),
    marketplaceAddress: requiredEnv("AGENTFLOW_MARKETPLACE_ADDRESS"),
    usdcAddress: requiredEnv("AGENTFLOW_USDC_ADDRESS"),
    orchestratorKey: requiredEnv("AGENT_OWNER_KEY"),
    bidPollIntervalMs: Number(process.env.ORCH_POLL_INTERVAL_MS ?? "5000"),
    bidPollTimeoutMs: Number(process.env.ORCH_POLL_TIMEOUT_MS ?? "30000"),
    minBids: Number(process.env.ORCH_MIN_BIDS ?? "1")
  });

  const result = await agent.run({
    title: process.env.ORCH_TASK_TITLE ?? "AgentFlow Task",
    description: process.env.ORCH_TASK_DESC ?? "Build a landing page",
    budgetUsdc6,
    deadlineUnix,
    tags: ["phase1", "deterministic-ranking"]
  });

  console.log(`[orchestrator] done jobId=${result.jobId} winner=${result.selectedWinner} bids=${result.bidsSeen}`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[orchestrator] failed ${message}`);
  process.exitCode = 1;
});
