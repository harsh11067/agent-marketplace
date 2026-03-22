import { createDelegation, getDeleGatorEnvironment } from '@metamask/delegation-toolkit'
import {
  SIGNABLE_DELEGATION_TYPED_DATA,
  createCaveatBuilder,
  getDelegationHashOffchain,
} from '@metamask/delegation-toolkit/utils'
import { keccak256, toUtf8Bytes } from 'ethers'

type HexAddress = `0x${string}`

function normalizeSalt(seed: string): `0x${string}` {
  return keccak256(toUtf8Bytes(seed)) as `0x${string}`
}

export type DelegationPayload = {
  domain: {
    name: string
    version: string
    chainId: number
    verifyingContract: string
  }
  types: Record<string, unknown>
  primaryType: 'Delegation'
    message: {
      delegate: string
      delegator: string
      authority: string
      caveats: Array<{
        enforcer: string
        terms: string
      }>
      salt: string
    }
}

export type DelegationRecordDraft = {
  kind: 'erc7715-delegation'
  chainId: number
  delegator: string
  delegate: string
  token: string
  capAmount: string
  nonce: string
  salt: string
  authority: string
  caveats: Array<{
    enforcer: string
    terms: string
    args: string
  }>
  deadline: number
  delegationManager: string
  digest: string
}

export function createDelegationPayload(input: {
  chainId: number
  delegator: string
  delegate: string
  token: string
  capAmount: string
  deadline: number
  nonceSeed: string
}): {
  payload: DelegationPayload
  record: DelegationRecordDraft
} {
  const environment = getDeleGatorEnvironment(input.chainId)
  const salt = normalizeSalt(input.nonceSeed)
  const delegation = createDelegation({
    environment,
    from: input.delegator as HexAddress,
    to: input.delegate as HexAddress,
    scope: {
      type: 'erc20TransferAmount',
      tokenAddress: input.token as HexAddress,
      maxAmount: BigInt(input.capAmount),
    },
    caveats: createCaveatBuilder(environment)
      .addCaveat('timestamp', {
        afterThreshold: 0,
        beforeThreshold: input.deadline,
      })
      .build(),
    salt,
  })

  const unsignedDelegation = {
    ...delegation,
    signature: '0x' as `0x${string}`,
  }
  const signableMessage = {
    delegate: unsignedDelegation.delegate,
    delegator: unsignedDelegation.delegator,
    authority: unsignedDelegation.authority,
    caveats: unsignedDelegation.caveats.map((caveat) => ({
      enforcer: caveat.enforcer,
      terms: caveat.terms,
    })),
    salt: BigInt(unsignedDelegation.salt).toString(),
  }

  return {
    payload: {
      domain: {
        chainId: input.chainId,
        name: 'DelegationManager',
        version: '1',
        verifyingContract: environment.DelegationManager,
      },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        ...((SIGNABLE_DELEGATION_TYPED_DATA ?? {}) as Record<string, unknown>),
      },
      primaryType: 'Delegation',
      message: signableMessage,
    },
    record: {
      kind: 'erc7715-delegation',
      chainId: input.chainId,
      delegator: input.delegator,
      delegate: input.delegate,
      token: input.token,
      capAmount: input.capAmount,
      nonce: salt,
      salt,
      authority: unsignedDelegation.authority,
      caveats: unsignedDelegation.caveats.map((caveat) => ({
        enforcer: caveat.enforcer,
        terms: caveat.terms,
        args: caveat.args,
      })),
      deadline: input.deadline,
      delegationManager: environment.DelegationManager,
      digest: getDelegationHashOffchain(unsignedDelegation),
    },
  }
}
