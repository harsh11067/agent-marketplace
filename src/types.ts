export type TaskStatus =
  | "queued"
  | "open"
  | "bidding"
  | "assigned"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export interface DelegationRecord {
  kind: "erc7715-delegation";
  chainId: number;
  delegator: string;
  delegate: string;
  token: string;
  capAmount: string;
  nonce: string;
  deadline: number;
  authority?: string;
  salt?: string;
  caveats?: Array<{
    enforcer: string;
    terms: string;
    args: string;
  }>;
  delegationManager?: string;
  digest?: string;
  signature?: string;
  signedAt?: number;
}

export interface SubDelegationRecord extends DelegationRecord {
  parentDigest?: string;
  createdAt?: number;
}

export interface MetaMaskPermissionRecord {
  context: string;
  address?: string;
  signer?: {
    type?: string;
    data?: Record<string, unknown>;
  };
  permission?: {
    type?: string;
    data?: Record<string, unknown>;
  };
  signerMeta?: {
    userOpBuilder?: string;
    delegationManager?: string;
  };
  dependencyInfo?: Array<{
    factory: string;
    factoryData: string;
  }>;
}

export interface SettlementRecord {
  provider: "uniswap" | "direct" | "mock";
  status: "quoted" | "submitted" | "settled" | "skipped" | "failed";
  tokenInAddress?: string;
  tokenOutAddress?: string;
  amountIn?: string;
  amountOut?: string;
  quoteId?: string;
  orderId?: string;
  txHash?: string;
  reason?: string;
}

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
  delegation?: DelegationRecord;
  subDelegation?: SubDelegationRecord;
  metamaskPermission?: MetaMaskPermissionRecord;

  // On-chain linkage / tx tracking
  chainJobId?: number;
  txHashes?: Record<string, string>;
  settlement?: SettlementRecord;

  selectedBidId?: string;
  selectedAgentId?: string;
  selectedBidPrice?: number;
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
  walletAddress?: string;
  preferredTokenAddress?: string;
  preferredTokenSymbol?: string;
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
