import type { AgentProfile, Bid, Task, TaskResult, Tool } from "../types.ts";
import { Planner } from "./planner.ts";
import { AgentMemory } from "./memory.ts";
import { TaskBoard } from "../marketplace/taskBoard.ts";
import { BiddingEngine } from "../marketplace/biddingEngine.ts";
import { PaymentManager } from "../blockchain/paymentManager.ts";
import { ReputationStore } from "../marketplace/reputation.ts";

export class AgentLoop {
  private readonly seenTasks = new Set<string>();
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
  }

  getActiveTasks(): Task[] {
    return this.taskBoard.listTasks().filter((task) => task.status !== "paid");
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
  }

  submitTask(
    description: string,
    overrides?: Partial<Pick<Task, "title" | "reward" | "requirements">>
  ): Task {
    const title = overrides?.title?.trim()
      || (description.length > 48 ? `${description.slice(0, 45)}...` : description);
    const task: Task = {
      id: `task-${Date.now()}`,
      title,
      description,
      reward: overrides?.reward ?? 90,
      requirements: overrides?.requirements?.length
        ? overrides.requirements
        : this.planner.createRequirements(description),
      createdBy: this.profile.id,
      status: "open"
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
  }

  private async onBidSubmitted(bid: Bid): Promise<void> {
    if (this.profile.role !== "coordinator") {
      return;
    }

    const task = this.taskBoard.getTask(bid.taskId);
    if (!task || task.createdBy !== this.profile.id || task.selectedBidId) {
      return;
    }

    const bids = this.taskBoard.getBids(task.id);
    if (bids.length < 2) {
      return;
    }

    const ranked = [...bids].sort((left, right) => this.planner.scoreBid(right) - this.planner.scoreBid(left));
    const winner = ranked[0];
    console.log(
      `[agent] evaluating bids agent=${this.profile.id} task=${task.id} candidates=${bids.length} winner=${winner.agentId}`
    );
    console.log(`[agent:bid-evaluate] agent=${this.profile.id} task=${task.id} bids=${bids.length} winner=${winner.agentId}`);
    this.taskBoard.selectBid(task.id, winner.id);
    const { escrowId, txHash } = await this.paymentManager.createEscrow(task, winner, this.profile.id);
    this.taskBoard.markEscrowCreated(task.id, escrowId, txHash);

    this.memory.record({
      agentId: this.profile.id,
      type: "bid_selected",
      message: `Selected ${winner.agentId} for ${task.id}`,
      timestamp: Date.now(),
      metadata: { bidId: winner.id, escrowId, txHash: txHash ?? "mock" }
    });
  }

  private async onBidSelected(task: Task, bid: Bid): Promise<void> {
    if (this.profile.id !== bid.agentId) {
      return;
    }

    console.log(`[agent] executing task agent=${this.profile.id} task=${task.id} phase=start`);
    console.log(`[agent:execute:start] agent=${this.profile.id} task=${task.id}`);
    this.taskBoard.startTask(task.id);
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
      return;
    }

    this.taskBoard.verifyTask(task.id);
    if (await this.paymentManager.releaseEscrow(task)) {
      this.taskBoard.markPaid(task.id);
      const winningBid = task.selectedBidId
        ? this.taskBoard.getBids(task.id).find((bid) => bid.id === task.selectedBidId)
        : undefined;

      if (winningBid) {
        this.reputationStore.reward(winningBid.agentId);
      }
    }

    this.memory.record({
      agentId: this.profile.id,
      type: "task_verified",
      message: `Verified and paid ${task.id}`,
      timestamp: Date.now(),
      metadata: { artifactPath: result.artifactPath }
    });
  }
}
