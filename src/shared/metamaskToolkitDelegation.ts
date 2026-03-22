import { getDeleGatorEnvironment, createDelegation, signDelegation } from "@metamask/delegation-toolkit";
import {
  SIGNABLE_DELEGATION_TYPED_DATA,
  createCaveatBuilder,
  getDelegationHashOffchain,
} from "@metamask/delegation-toolkit/utils";
import { keccak256, toUtf8Bytes } from "ethers";

import type { DelegationRecord, SubDelegationRecord } from "../types.ts";

type HexAddress = `0x${string}`;

type ToolkitDelegationShape = {
  delegate: HexAddress;
  delegator: HexAddress;
  authority: `0x${string}`;
  caveats: Array<{
    enforcer: `0x${string}`;
    terms: `0x${string}`;
    args: `0x${string}`;
  }>;
  salt: `0x${string}`;
  signature: `0x${string}`;
};

function normalizeSalt(seed: string): `0x${string}` {
  return keccak256(toUtf8Bytes(seed)) as `0x${string}`;
}

function createTimestampCaveats(chainId: number, deadlineUnix: number) {
  const environment = getDeleGatorEnvironment(chainId);
  return createCaveatBuilder(environment)
    .addCaveat("timestamp", {
      afterThreshold: 0,
      beforeThreshold: deadlineUnix
    })
    .build();
}

function createTypedData(params: {
  chainId: number;
  delegationManager: HexAddress;
  delegation: ToolkitDelegationShape;
}) {
  const signableMessage = {
    delegate: params.delegation.delegate,
    delegator: params.delegation.delegator,
    authority: params.delegation.authority,
    caveats: params.delegation.caveats.map((caveat) => ({
      enforcer: caveat.enforcer,
      terms: caveat.terms
    })),
    salt: BigInt(params.delegation.salt).toString()
  };

  return {
    domain: {
      chainId: params.chainId,
      name: "DelegationManager",
      version: "1",
      verifyingContract: params.delegationManager
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      ...((SIGNABLE_DELEGATION_TYPED_DATA ?? {}) as Record<string, unknown>)
    },
    primaryType: "Delegation",
    message: signableMessage
  } as const;
}

function toStoredRecord(params: {
  chainId: number;
  delegation: ToolkitDelegationShape;
  delegationManager: HexAddress;
  tokenAddress: HexAddress;
  capAmount: string;
  deadlineUnix: number;
  signature?: string;
  signedAt?: number;
}): DelegationRecord {
  const signedDelegation = {
    ...params.delegation,
    signature: (params.signature ?? params.delegation.signature ?? "0x") as `0x${string}`
  };
  const digest = getDelegationHashOffchain(signedDelegation);

  return {
    kind: "erc7715-delegation",
    chainId: params.chainId,
    delegator: signedDelegation.delegator,
    delegate: signedDelegation.delegate,
    token: params.tokenAddress,
    capAmount: params.capAmount,
    nonce: signedDelegation.salt,
    salt: signedDelegation.salt,
    authority: signedDelegation.authority,
    caveats: signedDelegation.caveats.map((caveat) => ({
      enforcer: caveat.enforcer,
      terms: caveat.terms,
      args: caveat.args
    })),
    deadline: params.deadlineUnix,
    delegationManager: params.delegationManager,
    digest,
    signature: signedDelegation.signature,
    signedAt: params.signedAt ?? Date.now()
  };
}

export function buildUserDelegationForMetaMask(params: {
  chainId: number;
  delegator: string;
  delegate: string;
  tokenAddress: string;
  capAmount: string;
  deadlineUnix: number;
  saltSeed: string;
}) {
  const environment = getDeleGatorEnvironment(params.chainId);
  const delegation = createDelegation({
    environment,
    from: params.delegator as HexAddress,
    to: params.delegate as HexAddress,
    scope: {
      type: "erc20TransferAmount",
      tokenAddress: params.tokenAddress as HexAddress,
      maxAmount: BigInt(params.capAmount)
    },
    caveats: createTimestampCaveats(params.chainId, params.deadlineUnix),
    salt: normalizeSalt(params.saltSeed)
  }) as ToolkitDelegationShape;

  const delegationManager = environment.DelegationManager as HexAddress;
  const payload = createTypedData({
    chainId: params.chainId,
    delegationManager,
    delegation: {
      ...delegation,
      signature: "0x"
    }
  });

  return {
    payload,
    recordTemplate: toStoredRecord({
      chainId: params.chainId,
      delegation: {
        ...delegation,
        signature: "0x"
      },
      delegationManager,
      tokenAddress: params.tokenAddress as HexAddress,
      capAmount: params.capAmount,
      deadlineUnix: params.deadlineUnix,
      signedAt: Date.now()
    })
  };
}

export function finalizeUserDelegationRecord(params: {
  chainId: number;
  delegator: string;
  delegate: string;
  tokenAddress: string;
  capAmount: string;
  deadlineUnix: number;
  salt: string;
  signature: string;
  signedAt?: number;
}): DelegationRecord {
  const environment = getDeleGatorEnvironment(params.chainId);
  const delegation = createDelegation({
    environment,
    from: params.delegator as HexAddress,
    to: params.delegate as HexAddress,
    scope: {
      type: "erc20TransferAmount",
      tokenAddress: params.tokenAddress as HexAddress,
      maxAmount: BigInt(params.capAmount)
    },
    caveats: createTimestampCaveats(params.chainId, params.deadlineUnix),
    salt: params.salt as `0x${string}`
  }) as ToolkitDelegationShape;

  return toStoredRecord({
    chainId: params.chainId,
    delegation: {
      ...delegation,
      signature: params.signature as `0x${string}`
    },
    delegationManager: environment.DelegationManager as HexAddress,
    tokenAddress: params.tokenAddress as HexAddress,
    capAmount: params.capAmount,
    deadlineUnix: params.deadlineUnix,
    signature: params.signature,
    signedAt: params.signedAt
  });
}

export function reconstructToolkitDelegation(record: DelegationRecord): ToolkitDelegationShape | null {
  if (!record.salt || !record.authority || !record.caveats?.length || !record.signature) {
    return null;
  }

  return {
    delegate: record.delegate as HexAddress,
    delegator: record.delegator as HexAddress,
    authority: record.authority as `0x${string}`,
    caveats: record.caveats.map((caveat) => ({
      enforcer: caveat.enforcer as `0x${string}`,
      terms: caveat.terms as `0x${string}`,
      args: caveat.args as `0x${string}`
    })),
    salt: record.salt as `0x${string}`,
    signature: record.signature as `0x${string}`
  };
}

export async function createSignedSubDelegation(params: {
  chainId: number;
  orchestratorKey: string;
  parentDelegation: DelegationRecord;
  specialistAddress: string;
  tokenAddress: string;
  capAmount: string;
  deadlineUnix: number;
  saltSeed: string;
}): Promise<SubDelegationRecord | null> {
  const parent = reconstructToolkitDelegation(params.parentDelegation);
  if (!parent) {
    return null;
  }

  const environment = getDeleGatorEnvironment(params.chainId);
  const delegation = createDelegation({
    environment,
    from: params.parentDelegation.delegate as HexAddress,
    to: params.specialistAddress as HexAddress,
    scope: {
      type: "erc20TransferAmount",
      tokenAddress: params.tokenAddress as HexAddress,
      maxAmount: BigInt(params.capAmount)
    },
    caveats: createTimestampCaveats(params.chainId, params.deadlineUnix),
    parentDelegation: parent,
    salt: normalizeSalt(params.saltSeed)
  }) as ToolkitDelegationShape;

  const signature = await signDelegation({
    privateKey: params.orchestratorKey as `0x${string}`,
    delegation: {
      ...delegation,
      signature: "0x"
    },
    delegationManager: environment.DelegationManager as HexAddress,
    chainId: params.chainId
  });

  return {
    ...toStoredRecord({
      chainId: params.chainId,
      delegation: {
        ...delegation,
        signature
      },
      delegationManager: environment.DelegationManager as HexAddress,
      tokenAddress: params.tokenAddress as HexAddress,
      capAmount: params.capAmount,
      deadlineUnix: params.deadlineUnix,
      signature,
      signedAt: Date.now()
    }),
    parentDigest: params.parentDelegation.digest,
    createdAt: Date.now()
  };
}
