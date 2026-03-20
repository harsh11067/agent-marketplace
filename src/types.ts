export type TaskStatus =
  | "queued"
  | "open"
  | "bidding"
  | "assigned"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export interface Task {
  id: string;
  createdAt?: number;
  title: string;
  description: string;
  reward: number;
  requirements: string[];
  createdBy: string;
  status: TaskStatus;
  failureReason?: string;

  // Delegation flow (User → Orchestrator → Specialist)
  delegator?: string;
  delegate?: string;
  deadline?: number;
  delegation?: unknown;
  subDelegation?: unknown;

  // On-chain linkage / tx tracking
  chainJobId?: number;
  txHashes?: Record<string, string>;

  selectedBidId?: string;
  selectedAgentId?: string;
  escrowId?: string;
  txHash?: string;
  result?: TaskResult;
}

export interface TaskResult {
  summary: string;
  artifactPath: string;
  verificationNotes: string;
}

export interface Bid {
  id: string;
  taskId: string;
  agentId: string;
  price: number;
  capabilityScore: number;
  reputationScore: number;
  rationale: string;
  createdAt: number;
}

export interface AgentProfile {
  id: string;
  name: string;
  role: "coordinator" | "worker";
  budget: number;
  capabilities: string[];
  minPrice: number;
}

export interface TaskView extends Task {
  selectedAgentName?: string;
  artifactPath?: string;
}

export interface AgentDecision {
  agentId: string;
  type: string;
  message: string;
  timestamp: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface ExecutionContext {
  task: Task;
  workspaceRoot: string;
}

export interface Tool<TInput, TOutput> {
  name: string;
  run(input: TInput, context: ExecutionContext): Promise<TOutput>;
}

export interface Escrow {
  id: string;
  taskId: string;
  payerAgentId: string;
  payeeAgentId: string;
  amount: number;
  status: "created" | "funded" | "released";
}

export interface EscrowCreateResult {
  id: string;
  txHash?: string;
}
