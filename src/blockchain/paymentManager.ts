import type { Bid, Task } from "../types.ts";
import { MockEscrowContract } from "./escrowContract.ts";
import type { EscrowContract } from "./escrowContract.ts";
import { isUniswapConfigured, settleUniswapPayout } from "../shared/uniswap.ts";

export class PaymentManager {
  private readonly escrowContract: EscrowContract;
  private readonly walletByAgentId: Record<string, string>;
  private readonly keyByAgentId: Record<string, string>;
  private readonly fallbackEscrowContract: MockEscrowContract;
  private readonly allowDevFallback: boolean;
  private readonly usdcAddress: string;
  private readonly rpcUrl: string;
  private readonly onchainMarketplaceEnabled: boolean;

  constructor(
    escrowContract: EscrowContract,
    walletByAgentId: Record<string, string>,
    keyByAgentId: Record<string, string> = {}
  ) {
    this.escrowContract = escrowContract;
    this.walletByAgentId = walletByAgentId;
    this.keyByAgentId = keyByAgentId;
    this.fallbackEscrowContract = escrowContract instanceof MockEscrowContract
      ? escrowContract
      : new MockEscrowContract();
    this.allowDevFallback = (process.env.DEV_MODE ?? "false").toLowerCase() === "true";
    this.usdcAddress = process.env.AGENTFLOW_USDC_ADDRESS ?? process.env.USDC_ADDRESS ?? "";
    this.rpcUrl = process.env.BASE_SEPOLIA_RPC ?? process.env.SEPOLIA_RPC_URL ?? "";
    this.onchainMarketplaceEnabled = Boolean(
      this.rpcUrl && process.env.AGENTFLOW_MARKETPLACE_ADDRESS && this.usdcAddress
    );
  }

  async createEscrow(task: Task, bid: Bid, payerAgentId: string): Promise<{ escrowId: string; txHash?: string }> {
    const payerAddress = this.walletByAgentId[payerAgentId];
    const workerAddress = this.walletByAgentId[bid.agentId];

    try {
      if (this.onchainMarketplaceEnabled && task.chainJobId) {
        return {
          escrowId: `onchain-job-${task.chainJobId}`,
          txHash: task.txHashes?.jobPosted
        };
      }
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

    if (this.onchainMarketplaceEnabled && task.chainJobId) {
      const settledOnchain = await this.waitForOnchainCompletion(task);
      if (!settledOnchain) {
        console.log(`[payment:attempt] task=${task.id} escrow=${task.escrowId} released=false tx=${task.txHash ?? "n/a"}`);
        return false;
      }
      console.log(
        `[payment:attempt] task=${task.id} escrow=${task.escrowId} released=true tx=${task.txHashes?.jobCompleted ?? task.txHash ?? "n/a"}`
      );
      await this.tryRecordUniswapSettlement(task);
      return true;
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
      if (released) {
        await this.tryRecordUniswapSettlement(task);
      }
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
      if (released) {
        await this.tryRecordUniswapSettlement(task);
      }
      return released;
    }
  }

  private async tryRecordUniswapSettlement(task: Task): Promise<void> {
    if (!isUniswapConfigured()) {
      task.settlement = {
        provider: "mock",
        status: "skipped",
        reason: "UNISWAP_API_KEY not configured"
      };
      return;
    }

    const selectedAgentId = task.selectedAgentId;
    if (!selectedAgentId) {
      task.settlement = {
        provider: "uniswap",
        status: "failed",
        reason: "No selected agent"
      };
      return;
    }

    const walletAddress = this.walletByAgentId[selectedAgentId];
    const walletKey = this.keyByAgentId[selectedAgentId];
    const preferredToken = selectedAgentId === "agent-builder"
      ? (process.env.AGENT_BUILDER_PREFERRED_TOKEN ?? this.usdcAddress)
      : selectedAgentId === "agent-design"
        ? (process.env.AGENT_DESIGN_PREFERRED_TOKEN ?? this.usdcAddress)
        : this.usdcAddress;

    if (!walletAddress || !walletKey || !this.usdcAddress || !preferredToken || !this.rpcUrl) {
      task.settlement = {
        provider: "uniswap",
        status: "failed",
        reason: "Missing wallet, signer, token, or rpc config"
      };
      return;
    }

    try {
      const payoutAmount = task.selectedBidPrice ?? task.reward;
      const amount = String(Math.max(1, Math.floor(payoutAmount * 1_000_000)));
      const execution = await settleUniswapPayout({
        rpcUrl: this.rpcUrl,
        walletKey,
        tokenInAddress: this.usdcAddress,
        tokenOutAddress: preferredToken,
        amount
      });
      task.settlement = {
        provider: "uniswap",
        status: "settled",
        tokenInAddress: this.usdcAddress,
        tokenOutAddress: preferredToken,
        amountIn: amount,
        orderId: typeof execution.orderId === "string" ? execution.orderId : typeof execution.orderHash === "string" ? execution.orderHash : undefined,
        txHash: typeof execution.txHash === "string" ? execution.txHash : undefined
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      task.settlement = {
        provider: "uniswap",
        status: "failed",
        tokenInAddress: this.usdcAddress,
        tokenOutAddress: preferredToken,
        reason
      };
    }
  }

  private async waitForOnchainCompletion(task: Task): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < 30_000) {
      if (task.txHashes?.jobCompleted) {
        return true;
      }
      if (task.status === "failed" || task.failureReason) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return Boolean(task.txHashes?.jobCompleted);
  }
}
