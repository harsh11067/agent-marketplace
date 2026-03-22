type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<any>;
};

export type MetaMaskPermissionRequestResult = {
  context: string;
  address?: string;
  signer?: {
    type?: string;
    data?: Record<string, unknown>;
  };
  permission?: {
    type?: string;
    data?: Record<string, unknown>;
  };
  signerMeta?: {
    userOpBuilder?: string;
    delegationManager?: string;
  };
  dependencyInfo?: Array<{
    factory: string;
    factoryData: string;
  }>;
};

export type ExecutionPermissionSupport = {
  supported: boolean;
  reason?: string;
};

export async function detectExecutionPermissionSupport(params: {
  ethereum: EthereumProvider;
  chainId: number;
  permissionType: string;
}): Promise<ExecutionPermissionSupport> {
  try {
    const result = await params.ethereum.request({
      method: 'wallet_getSupportedExecutionPermissions',
      params: [],
    }) as Record<string, { chainIds?: string[]; ruleTypes?: string[] }> | null

    if (!result || typeof result !== 'object') {
      return { supported: false, reason: 'wallet did not return supported execution permissions' }
    }

    const support = result[params.permissionType]
    const chainIdHex = `0x${params.chainId.toString(16)}`
    if (!support) {
      return { supported: false, reason: `permission type '${params.permissionType}' is not enabled` }
    }
    if (Array.isArray(support.chainIds) && support.chainIds.length > 0 && !support.chainIds.includes(chainIdHex)) {
      return { supported: false, reason: `permission type '${params.permissionType}' is not enabled on chain ${chainIdHex}` }
    }
    return { supported: true }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error && 'message' in error
          ? String((error as { message?: unknown }).message)
          : String(error)
    return { supported: false, reason: message }
  }
}

export async function requestExecutionPermission(params: {
  ethereum: EthereumProvider;
  chainId: number;
  orchestratorAddress: string;
  tokenAddress: string;
  periodAmount: bigint;
  deadlineUnix: number;
}): Promise<MetaMaskPermissionRequestResult | null> {
  const periodDuration = Math.max(60, params.deadlineUnix - Math.floor(Date.now() / 1000));
  const chainIdHex = `0x${params.chainId.toString(16)}`;
  const permissionRequest = {
    chainId: chainIdHex,
    to: params.orchestratorAddress,
    permission: {
      type: 'erc20-token-periodic',
      isAdjustmentAllowed: false,
      data: {
        tokenAddress: params.tokenAddress,
        periodAmount: `0x${params.periodAmount.toString(16)}`,
        periodDuration,
        justification: 'AgentFlow task budget delegation',
      },
    },
    rules: null,
  };
  const response = await params.ethereum.request({
    method: 'wallet_requestExecutionPermissions',
    params: [permissionRequest],
  });

  const first = Array.isArray(response) ? response[0] : null;
  if (!first || typeof first.context !== 'string') {
    return null;
  }

  return {
    context: first.context,
    address: typeof first.address === 'string' ? first.address : undefined,
    signer: first.signer,
    permission: first.permission,
    signerMeta: first.signerMeta,
    dependencyInfo: Array.isArray(first.dependencyInfo) ? first.dependencyInfo : [],
  };
}
