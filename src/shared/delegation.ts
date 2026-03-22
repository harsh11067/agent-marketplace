import { TypedDataEncoder, keccak256, toUtf8Bytes } from "ethers";
import type { DelegationRecord } from "../types.ts";

export type DelegationPayloadInput = {
  chainId: number;
  delegator: string;
  delegate: string;
  token: string;
  capAmount: string;
  deadline: number;
  nonce: string;
};

export function createDelegationTypedData(input: DelegationPayloadInput) {
  return {
    domain: {
      name: "AgentFlowDelegation",
      version: "1",
      chainId: input.chainId
    },
    primaryType: "Delegation",
    types: {
      Delegation: [
        { name: "delegator", type: "address" },
        { name: "delegate", type: "address" },
        { name: "token", type: "address" },
        { name: "capAmount", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "nonce", type: "bytes32" }
      ]
    },
    message: {
      delegator: input.delegator,
      delegate: input.delegate,
      token: input.token,
      capAmount: input.capAmount,
      deadline: input.deadline,
      nonce: input.nonce
    }
  } as const;
}

export function createDelegationDigest(input: DelegationPayloadInput): string {
  const typedData = createDelegationTypedData(input);
  return TypedDataEncoder.hash(typedData.domain, { Delegation: typedData.types.Delegation }, typedData.message);
}

export function createDelegationNonce(seed: string): string {
  return keccak256(toUtf8Bytes(seed));
}

export function toDelegationRecord(input: DelegationPayloadInput & { signature?: string }): DelegationRecord {
  return {
    kind: "erc7715-delegation",
    chainId: input.chainId,
    delegator: input.delegator,
    delegate: input.delegate,
    token: input.token,
    capAmount: input.capAmount,
    nonce: input.nonce,
    deadline: input.deadline,
    digest: createDelegationDigest(input),
    signature: input.signature,
    signedAt: Date.now()
  };
}
