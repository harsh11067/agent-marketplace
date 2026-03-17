import type { Bid, Task } from "../types.ts";
import { MockEscrowContract } from "./escrowContract.ts";
import type { EscrowContract } from "./escrowContract.ts";

export class PaymentManager {
  private readonly escrowContract: EscrowContract;
  private readonly walletByAgentId: Record<string, string>;
  private readonly fallbackEscrowContract: MockEscrowContract;

  constructor(escrowContract: EscrowContract, walletByAgentId: Record<string, string>) {
    this.escrowContract = escrowContract;
    this.walletByAgentId = walletByAgentId;
    this.fallbackEscrowContract = escrowContract instanceof MockEscrowContract
      ? escrowContract
      : new MockEscrowContract();
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
        `[payment:create] task=${task.id} escrow=${escrow.id} payer=${payerAgentId} payee=${bid.agentId} amount=${bid.price} tx=${escrow.txHash ?? "mock"}`
      );
      return { escrowId: escrow.id, txHash: escrow.txHash };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[payment:fallback] task=${task.id} reason=${message}`);
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
        const fallbackReleased = Boolean(await this.fallbackEscrowContract.releaseEscrow(task.id));
        console.log(`[payment:fallback:release] task=${task.id} reason=primary-release-missed`);
        console.log(`[payment:attempt] task=${task.id} escrow=${task.escrowId} released=${fallbackReleased} tx=mock`);
        return fallbackReleased;
      }

      console.log(
        `[payment:attempt] task=${task.id} escrow=${task.escrowId} released=${released} tx=${task.txHash ?? "mock"}`
      );
      return released;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[payment:fallback:release] task=${task.id} reason=${message}`);
      const released = Boolean(await this.fallbackEscrowContract.releaseEscrow(task.id));
      console.log(`[payment:attempt] task=${task.id} escrow=${task.escrowId} released=${released} tx=mock`);
      return released;
    }
  }
}
