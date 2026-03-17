import { BrowserProvider, Contract, JsonRpcProvider, Wallet, formatUnits, parseEther } from "ethers";

import type { Escrow, EscrowCreateResult } from "../types.ts";

export interface EscrowContract {
  createEscrow(taskId: string, payerAddress: string, workerAddress: string, amount: number): Promise<EscrowCreateResult>;
  releaseEscrow(taskId: string): Promise<Escrow | undefined>;
}

export class MockEscrowContract implements EscrowContract {
  private readonly escrows = new Map<string, Escrow>();

  async createEscrow(taskId: string, payerAgentId: string, payeeAgentId: string, amount: number): Promise<EscrowCreateResult> {
    const escrow: Escrow = {
      id: `escrow-${taskId}`,
      taskId,
      payerAgentId,
      payeeAgentId,
      amount,
      status: "funded"
    };

    this.escrows.set(escrow.id, escrow);
    return { id: escrow.id };
  }

  async releaseEscrow(taskId: string): Promise<Escrow | undefined> {
    const escrowId = `escrow-${taskId}`;
    const escrow = this.escrows.get(escrowId);
    if (!escrow) {
      return undefined;
    }

    escrow.status = "released";
    return escrow;
  }

  getEscrow(escrowId: string): Escrow | undefined {
    return this.escrows.get(escrowId);
  }
}

const escrowAbi = [
  "function createEscrow(string taskId, address workerAddress, uint256 amount) payable",
  "function releaseEscrow(string taskId)"
] as const;

export class EthersEscrowContract implements EscrowContract {
  private readonly contractAddress: string;
  private readonly rpcUrl: string;
  private readonly signerKey?: string;

  constructor(contractAddress: string, rpcUrl: string, signerKey?: string) {
    this.contractAddress = contractAddress;
    this.rpcUrl = rpcUrl;
    this.signerKey = signerKey;
  }

  private async getSigner() {
    const maybeEthereum = (globalThis as { ethereum?: unknown }).ethereum;
    if (maybeEthereum) {
      const provider = new BrowserProvider(maybeEthereum as any);
      return provider.getSigner();
    }

    if (!this.signerKey) {
      return undefined;
    }

    const provider = new JsonRpcProvider(this.rpcUrl);
    return new Wallet(this.signerKey, provider);
  }

  async createEscrow(taskId: string, payerAddress: string, workerAddress: string, amount: number): Promise<EscrowCreateResult> {
    const signer = await this.getSigner();
    if (!signer) {
      throw new Error("wallet not connected");
    }

    const contract = new Contract(this.contractAddress, escrowAbi, signer);
    const value = parseEther(String(amount / 100));
    const tx = await contract.createEscrow(taskId, workerAddress, value, { value });

    console.log(
      `[payment:onchain:create] task=${taskId} payer=${payerAddress} worker=${workerAddress} amountEth=${formatUnits(value, 18)} tx=${tx.hash}`
    );

    return {
      id: `escrow-${taskId}`,
      txHash: tx.hash
    };
  }

  async releaseEscrow(taskId: string): Promise<Escrow | undefined> {
    const signer = await this.getSigner();
    if (!signer) {
      throw new Error("wallet not connected");
    }

    const contract = new Contract(this.contractAddress, escrowAbi, signer);
    const tx = await contract.releaseEscrow(taskId);
    console.log(`[payment:onchain:release] task=${taskId} tx=${tx.hash}`);

    return {
      id: `escrow-${taskId}`,
      taskId,
      payerAgentId: "onchain",
      payeeAgentId: "onchain",
      amount: 0,
      status: "released"
    };
  }
}

export function createEscrowContract(): EscrowContract {
  const contractAddress = process.env.ESCROW_CONTRACT_ADDRESS;
  const rpcUrl = process.env.SEPOLIA_RPC_URL ?? "https://rpc.sepolia.org";
  const signerKey = process.env.SEPOLIA_PRIVATE_KEY;

  if (contractAddress) {
    return new EthersEscrowContract(contractAddress, rpcUrl, signerKey);
  }

  return new MockEscrowContract();
}
