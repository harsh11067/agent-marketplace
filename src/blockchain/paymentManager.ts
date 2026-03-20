import type { Bid, Task } from "../types.ts";
import { MockEscrowContract } from "./escrowContract.ts";
import type { EscrowContract } from "./escrowContract.ts";

export class PaymentManager {
  private readonly escrowContract: EscrowContract;
  private readonly walletByAgentId: Record<string, string>;
  private readonly fallbackEscrowContract: MockEscrowContract;
  private readonly allowDevFallback: boolean;

  constructor(escrowContract: EscrowContract, walletByAgentId: Record<string, string>) {
    this.escrowContract = escrowContract;
    this.walletByAgentId = walletByAgentId;
    this.fallbackEscrowContract = escrowContract instanceof MockEscrowContract
      ? escrowContract
      : new MockEscrowContract();
    this.allowDevFallback = (process.env.DEV_MODE ?? "false").toLowerCase() === "true";
  }

  async createEscrow(task: Task, bid: Bid, payerAgentId: string): Promise<{ escrowId: string; txHash?: string }> {
    const payerAddress = this.walletByAgentId[payerAgentId];
    const workerAddress = this.walletByAgentId[bid.agentId];

    try {
      if (!payerAddress || !workerAddress) {
        throw new Error("wallet not connected");
      }

      const escrow = await this.escrowContract.createEscrow(task.id, payerAddress, workerAddress, bid.price);
      console.log(
        `[payment:create] task=${task.id} escrow=${escrow.id} payer=${payerAgentId} payee=${bid.agentId} amount=${bid.price} tx=${escrow.txHash ?? "n/a"}`
      );
      return { escrowId: escrow.id, txHash: escrow.txHash };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.allowDevFallback) {
        throw new Error(`payment create failed (DEV_MODE=false): ${message}`);
      }
      console.log(`[payment:fallback] task=${task.id} reason=${message} mode=dev`);
      const escrow = await this.fallbackEscrowContract.createEscrow(task.id, payerAgentId, bid.agentId, bid.price);
      return { escrowId: escrow.id };
    }
  }

  async releaseEscrow(task: Task): Promise<boolean> {
    if (!task.escrowId) {
      return false;
    }

    try {
      const released = Boolean(await this.escrowContract.releaseEscrow(task.id));
      if (!released && !task.txHash) {
        if (!this.allowDevFallback) {
          console.log(`[payment:attempt] task=${task.id} escrow=${task.escrowId} released=false tx=n/a`);
          return false;
        }
        const fallbackReleased = Boolean(await this.fallbackEscrowContract.releaseEscrow(task.id));
        console.log(`[payment:fallback:release] task=${task.id} reason=primary-release-missed mode=dev`);
        console.log(`[payment:attempt] task=${task.id} escrow=${task.escrowId} released=${fallbackReleased} tx=mock`);
        return fallbackReleased;
      }

      console.log(
        `[payment:attempt] task=${task.id} escrow=${task.escrowId} released=${released} tx=${task.txHash ?? "n/a"}`
      );
      return released;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.allowDevFallback) {
        console.log(`[payment:attempt] task=${task.id} escrow=${task.escrowId} released=false tx=n/a reason=${message}`);
        return false;
      }
      console.log(`[payment:fallback:release] task=${task.id} reason=${message} mode=dev`);
      const released = Boolean(await this.fallbackEscrowContract.releaseEscrow(task.id));
      console.log(`[payment:attempt] task=${task.id} escrow=${task.escrowId} released=${released} tx=mock`);
      return released;
    }
  }
}
