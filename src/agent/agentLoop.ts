import type { AgentProfile, Bid, Task, TaskResult, Tool } from "../types.ts";
import { Planner } from "./planner.ts";
import { AgentMemory } from "./memory.ts";
import { TaskBoard } from "../marketplace/taskBoard.ts";
import { BiddingEngine } from "../marketplace/biddingEngine.ts";
import { PaymentManager } from "../blockchain/paymentManager.ts";
import { ReputationStore } from "../marketplace/reputation.ts";

export class AgentLoop {
  private readonly seenTasks = new Set<string>();
  private readonly biddingTimers = new Map<string, NodeJS.Timeout>();
  private readonly biddingWindowMs: number;
  private timer?: NodeJS.Timeout;
  readonly profile: AgentProfile;
  private readonly taskBoard: TaskBoard;
  private readonly planner: Planner;
  private readonly memory: AgentMemory;
  private readonly biddingEngine: BiddingEngine;
  private readonly paymentManager: PaymentManager;
  private readonly reputationStore: ReputationStore;
  private readonly tools: Record<string, Tool<unknown, unknown>>;
  private readonly workspaceRoot: string;

  constructor(
    profile: AgentProfile,
    taskBoard: TaskBoard,
    planner: Planner,
    memory: AgentMemory,
    biddingEngine: BiddingEngine,
    paymentManager: PaymentManager,
    reputationStore: ReputationStore,
    tools: Record<string, Tool<unknown, unknown>>,
    workspaceRoot: string
  ) {
    this.profile = profile;
    this.taskBoard = taskBoard;
    this.planner = planner;
    this.memory = memory;
    this.biddingEngine = biddingEngine;
    this.paymentManager = paymentManager;
    this.reputationStore = reputationStore;
    this.tools = tools;
    this.workspaceRoot = workspaceRoot;
    this.biddingWindowMs = Math.max(1_500, Number(process.env.BIDDING_WINDOW_MS ?? "8000"));
  }

  getActiveTasks(): Task[] {
    return this.taskBoard
      .listTasks()
      .filter((task) => !["completed", "failed", "cancelled"].includes(task.status));
  }

  start(): void {
    this.taskBoard.on("taskPosted", (task) => this.onTaskPosted(task));
    this.taskBoard.on("bidSubmitted", (bid) => {
      void this.onBidSubmitted(bid);
    });
    this.taskBoard.on("bidSelected", (task, bid) => this.onBidSelected(task, bid));
    this.taskBoard.on("resultSubmitted", (task, result) => {
      void this.onResultSubmitted(task, result);
    });

    this.timer = setInterval(() => {
      this.memory.record({
        agentId: this.profile.id,
        type: "heartbeat",
        message: `${this.profile.name} observing marketplace`,
        timestamp: Date.now()
      });
    }, 3_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    for (const timer of this.biddingTimers.values()) {
      clearTimeout(timer);
    }
    this.biddingTimers.clear();
  }

  submitTask(
    description: string,
    overrides?: Partial<
      Pick<
        Task,
        | "title"
        | "reward"
        | "requirements"
        | "delegator"
        | "delegate"
        | "deadline"
        | "delegation"
        | "subDelegation"
        | "chainJobId"
        | "txHashes"
      >
    >
  ): Task {
    const title = overrides?.title?.trim()
      || (description.length > 48 ? `${description.slice(0, 45)}...` : description);
    const task: Task = {
      id: `task-${Date.now()}`,
      createdAt: Date.now(),
      title,
      description,
      reward: overrides?.reward ?? 90,
      requirements: overrides?.requirements?.length
        ? overrides.requirements
        : this.planner.createRequirements(description),
      createdBy: this.profile.id,
      status: "queued",
      delegator: overrides?.delegator,
      delegate: overrides?.delegate,
      deadline: overrides?.deadline,
      delegation: overrides?.delegation,
      subDelegation: overrides?.subDelegation,
      chainJobId: overrides?.chainJobId,
      txHashes: overrides?.txHashes
    };

    this.memory.record({
      agentId: this.profile.id,
      type: "task_posted",
      message: `Posted task ${task.id}`,
      timestamp: Date.now(),
      metadata: { requirements: task.requirements.join(", ") }
    });

    console.log(`[agent:task-post] agent=${this.profile.id} task=${task.id}`);
    return this.taskBoard.postTask(task);
  }

  private onTaskPosted(task: Task): void {
    if (this.profile.role !== "worker" || task.createdBy === this.profile.id || this.seenTasks.has(task.id)) {
      return;
    }

    this.seenTasks.add(task.id);
    console.log(
      `[agent] detected task agent=${this.profile.id} task=${task.id} requirements=${task.requirements.join(",")}`
    );

    // Dynamic latency from Idea.md (Builder: 5s, Designer: 8s, Writer: 6s).
    const latency = this.profile.name.includes("Builder")
      ? Number(process.env.BID_LATENCY_BUILDER_MS ?? "5000")
      : this.profile.name.includes("Design")
        ? Number(process.env.BID_LATENCY_DESIGN_MS ?? "8000")
        : Number(process.env.BID_LATENCY_DEFAULT_MS ?? "6000");

    setTimeout(() => {
      const live = this.taskBoard.getTask(task.id);
      if (!live || !["open", "bidding"].includes(live.status)) {
        return;
      }
      if (!this.shouldBid(live)) {
        console.log(`[agent:bid-skip] agent=${this.profile.id} task=${task.id} reason=capability-mismatch`);
        return;
      }

      const bid = this.biddingEngine.createBid(task, this.profile);
      console.log(
        `[agent] created bid agent=${this.profile.id} bid=${bid.id} task=${task.id} price=${bid.price} score=${bid.capabilityScore}`
      );

      this.memory.record({
        agentId: this.profile.id,
        type: "bid_submitted",
        message: `Submitted bid ${bid.id} on ${task.id}`,
        timestamp: Date.now(),
        metadata: { price: bid.price, capability: bid.capabilityScore }
      });

      console.log(`[agent] submitted bid agent=${this.profile.id} bid=${bid.id} task=${task.id}`);
      console.log(`[agent:bid-submit] agent=${this.profile.id} bid=${bid.id} task=${task.id}`);
      this.taskBoard.submitBid(bid);
    }, latency);
  }

  private async onBidSubmitted(bid: Bid): Promise<void> {
    if (this.profile.role !== "coordinator") {
      return;
    }

    const task = this.taskBoard.getTask(bid.taskId);
    if (!task || task.createdBy !== this.profile.id || task.selectedBidId) {
      return;
    }

    if (this.biddingTimers.has(task.id)) {
      return;
    }

    const timer = setTimeout(() => {
      this.biddingTimers.delete(task.id);
      void this.evaluateTaskBids(task.id);
    }, this.biddingWindowMs);
    timer.unref();
    this.biddingTimers.set(task.id, timer);
    console.log(`[agent:bid-window] agent=${this.profile.id} task=${task.id} windowMs=${this.biddingWindowMs}`);
  }

  private async onBidSelected(task: Task, bid: Bid): Promise<void> {
    if (this.profile.id !== bid.agentId) {
      return;
    }

    console.log(`[agent] executing task agent=${this.profile.id} task=${task.id} phase=start`);
    console.log(`[agent:execute:start] agent=${this.profile.id} task=${task.id}`);
    this.taskBoard.startTask(task.id);
    
    // Simulate execution time
    await new Promise(r => setTimeout(r, 6000));

    const context = { task, workspaceRoot: this.workspaceRoot };
    const webSearch = this.tools.webSearch as Tool<{ query: string }, string[]>;
    const codeGenerator = this.tools.codeGenerator as Tool<
      { prompt: string; research: string[] },
      { filename: string; content: string }
    >;
    const fileWriter = this.tools.fileWriter as Tool<{ filename: string; content: string }, string>;

    const research = await webSearch.run({ query: task.description }, context);
    const artifact = await codeGenerator.run(
      {
        prompt: `Deliverable for task: ${task.description}`,
        research
      },
      context
    );
    const artifactPath = await fileWriter.run(artifact, context);

    const result: TaskResult = {
      summary: `${this.profile.name} completed ${task.title}`,
      artifactPath,
      verificationNotes: `Generated artifact using ${research.length} research signals.`
    };

    this.memory.record({
      agentId: this.profile.id,
      type: "task_completed",
      message: `Completed ${task.id}`,
      timestamp: Date.now(),
      metadata: { artifactPath }
    });

    console.log(`[agent] executing task agent=${this.profile.id} task=${task.id} phase=end artifact=${artifactPath}`);
    console.log(`[agent:execute:done] agent=${this.profile.id} task=${task.id} artifact=${artifactPath}`);
    this.taskBoard.submitResult(task.id, result);
  }

  private async onResultSubmitted(task: Task, result: TaskResult): Promise<void> {
    if (this.profile.role !== "coordinator" || task.createdBy !== this.profile.id) {
      return;
    }

    const verified = this.planner.verifyResult(task, result);
    console.log(`[agent:verify] agent=${this.profile.id} task=${task.id} verified=${verified}`);
    if (!verified) {
      this.taskBoard.markFailed(task.id, "result verification failed");
      return;
    }

    const winningBid = task.selectedBidId
      ? this.taskBoard.getBids(task.id).find((bid) => bid.id === task.selectedBidId)
      : undefined;

    // If an on-chain completion tx exists, treat payment as settled in contract.
    const hasOnchainPayout = Boolean(task.txHashes?.jobCompleted);
    if (hasOnchainPayout || (await this.paymentManager.releaseEscrow(task))) {
      this.taskBoard.markCompleted(task.id);
      if (winningBid) {
        this.reputationStore.reward(winningBid.agentId);
      }
    } else {
      this.taskBoard.markFailed(task.id, "payment release failed");
    }

    this.memory.record({
      agentId: this.profile.id,
      type: "task_verified",
      message: `Verified and finalized ${task.id}`,
      timestamp: Date.now(),
      metadata: { artifactPath: result.artifactPath }
    });
  }

  private async evaluateTaskBids(taskId: string): Promise<void> {
    const task = this.taskBoard.getTask(taskId);
    if (!task || task.createdBy !== this.profile.id || task.selectedBidId) {
      return;
    }

    const bids = this.taskBoard.getBids(task.id);
    if (bids.length === 0) {
      this.taskBoard.markFailed(task.id, "no bids received in bidding window");
      return;
    }

    const ranked = [...bids].sort((left, right) => {
      const scoreDelta = this.planner.scoreBid(right) - this.planner.scoreBid(left);
      if (scoreDelta !== 0) return scoreDelta;
      if (left.price !== right.price) return left.price - right.price;
      if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
      return left.agentId.localeCompare(right.agentId);
    });

    const winner = ranked[0];
    console.log(
      `[agent] evaluating bids agent=${this.profile.id} task=${task.id} candidates=${bids.length} winner=${winner.agentId}`
    );
    console.log(`[agent:bid-evaluate] agent=${this.profile.id} task=${task.id} bids=${bids.length} winner=${winner.agentId}`);
    this.taskBoard.selectBid(task.id, winner.id);

    try {
      const { escrowId, txHash } = await this.paymentManager.createEscrow(task, winner, this.profile.id);
      this.taskBoard.markEscrowCreated(task.id, escrowId, txHash);
      this.memory.record({
        agentId: this.profile.id,
        type: "bid_selected",
        message: `Selected ${winner.agentId} for ${task.id}`,
        timestamp: Date.now(),
        metadata: { bidId: winner.id, escrowId, txHash: txHash ?? "n/a" }
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.taskBoard.markFailed(task.id, `escrow creation failed: ${reason}`);
    }
  }

  private shouldBid(task: Task): boolean {
    const required = task.requirements.map((item) => item.toLowerCase());
    const capabilities = this.profile.capabilities.map((item) => item.toLowerCase());
    return required.some((req) => capabilities.some((cap) => req.includes(cap) || cap.includes(req)));
  }
}
