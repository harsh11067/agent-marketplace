import { EventEmitter } from "node:events";
import type { Bid, Task, TaskResult } from "../types.ts";

export class TaskBoard extends EventEmitter {
  private tasks = new Map<string, Task>();
  private bidsByTask = new Map<string, Bid[]>();

  importTasks(tasks: Task[]): void {
    for (const task of tasks) {
      this.tasks.set(task.id, task);
    }
  }

  postTask(task: Task): Task {
    this.tasks.set(task.id, task);
    console.log(`[task:create] ${task.id} "${task.title}" reward=${task.reward}`);
    this.emit("taskPosted", task);
    return task;
  }

  listTasks(): Task[] {
    return [...this.tasks.values()];
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  submitBid(bid: Bid): void {
    const bids = this.bidsByTask.get(bid.taskId) ?? [];
    bids.push(bid);
    this.bidsByTask.set(bid.taskId, bids);
    console.log(
      `[bid:submit] ${bid.id} task=${bid.taskId} agent=${bid.agentId} price=${bid.price} score=${bid.capabilityScore}`
    );
    this.emit("bidSubmitted", bid);
  }

  getBids(taskId: string): Bid[] {
    return this.bidsByTask.get(taskId) ?? [];
  }

  selectBid(taskId: string, bidId: string): Bid | undefined {
    const task = this.tasks.get(taskId);
    const bid = this.getBids(taskId).find(b => b.id === bidId);

    if (!task || !bid) return;

    task.selectedBidId = bid.id;
    task.selectedAgentId = bid.agentId;
    task.status = "assigned";
    console.log(`[bid:select] task=${taskId} bid=${bidId} agent=${bid.agentId}`);
    this.emit("bidSelected", task, bid);
    return bid;
  }

  markEscrowCreated(taskId: string, escrowId: string, txHash?: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.escrowId = escrowId;
    task.txHash = txHash;
    console.log(`[payment:escrow] task=${taskId} escrow=${escrowId} tx=${txHash ?? "mock"}`);
    this.emit("escrowCreated", task);
  }

  startTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = "in_progress";
    console.log(`[task:execute] ${taskId} status=in_progress`);
    this.emit("taskStarted", task);
  }

  submitResult(taskId: string, result: TaskResult): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.result = result;
    task.status = "submitted";
    console.log(`[task:result] ${taskId} artifact=${result.artifactPath}`);
    this.emit("resultSubmitted", task, result);
  }

  verifyTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = "verified";
    console.log(`[task:verify] ${taskId} status=verified`);
    this.emit("taskVerified", task);
  }

  markPaid(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = "paid";
    console.log(`[payment:release] ${taskId} status=paid`);
    this.emit("paymentReleased", task);
  }
}
