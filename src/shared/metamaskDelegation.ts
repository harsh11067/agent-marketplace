import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { createPublicClient, createWalletClient, encodeFunctionData, http } from "viem";
import { erc7710WalletActions } from "@metamask/delegation-toolkit/experimental";
import { agentMarketplaceAbi, erc20Abi } from "./contracts.ts";

type DelegatedExecutionParams = {
  rpcUrl: string;
  orchestratorKey: string;
  permissionsContext: `0x${string}`;
  delegationManager: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
};

function createDelegatedWalletClient(params: {
  rpcUrl: string;
  orchestratorKey: string;
}) {
  const account = privateKeyToAccount(params.orchestratorKey as `0x${string}`);
  return createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(params.rpcUrl)
  }).extend(erc7710WalletActions());
}

export async function sendDelegatedTransaction(params: DelegatedExecutionParams): Promise<`0x${string}`> {
  const client = createDelegatedWalletClient({
    rpcUrl: params.rpcUrl,
    orchestratorKey: params.orchestratorKey
  });

  return client.sendTransactionWithDelegation({
    account: client.account,
    to: params.to,
    data: params.data,
    permissionsContext: params.permissionsContext,
    delegationManager: params.delegationManager
  });
}

export async function delegatedApproveUsdc(params: {
  rpcUrl: string;
  orchestratorKey: string;
  permissionsContext: `0x${string}`;
  delegationManager: `0x${string}`;
  usdcAddress: `0x${string}`;
  spender: `0x${string}`;
  amount: bigint;
}): Promise<{ txHash: `0x${string}` }> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [params.spender, params.amount]
  });

  const txHash = await sendDelegatedTransaction({
    rpcUrl: params.rpcUrl,
    orchestratorKey: params.orchestratorKey,
    permissionsContext: params.permissionsContext,
    delegationManager: params.delegationManager,
    to: params.usdcAddress,
    data
  });

  return { txHash };
}

export async function delegatedPostJob(params: {
  rpcUrl: string;
  orchestratorKey: string;
  permissionsContext: `0x${string}`;
  delegationManager: `0x${string}`;
  marketplaceAddress: `0x${string}`;
  taskURI: string;
  budgetUsdc6: bigint;
  deadlineUnix: number;
}): Promise<{ txHash: `0x${string}`; jobId: number }> {
  const data = encodeFunctionData({
    abi: agentMarketplaceAbi,
    functionName: "postJob",
    args: [params.taskURI, params.budgetUsdc6, BigInt(params.deadlineUnix)]
  });

  const txHash = await sendDelegatedTransaction({
    rpcUrl: params.rpcUrl,
    orchestratorKey: params.orchestratorKey,
    permissionsContext: params.permissionsContext,
    delegationManager: params.delegationManager,
    to: params.marketplaceAddress,
    data
  });

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(params.rpcUrl)
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  const jobCount = await publicClient.readContract({
    address: params.marketplaceAddress,
    abi: agentMarketplaceAbi,
    functionName: "jobCount"
  });

  return { txHash, jobId: Number(jobCount) };
}

export async function delegatedAssignJob(params: {
  rpcUrl: string;
  orchestratorKey: string;
  permissionsContext: `0x${string}`;
  delegationManager: `0x${string}`;
  marketplaceAddress: `0x${string}`;
  jobId: number;
  winnerAddress: `0x${string}`;
  agreedPriceUsdc6: bigint;
}): Promise<{ txHash: `0x${string}` }> {
  const data = encodeFunctionData({
    abi: agentMarketplaceAbi,
    functionName: "assignJob",
    args: [BigInt(params.jobId), params.winnerAddress, params.agreedPriceUsdc6]
  });

  const txHash = await sendDelegatedTransaction({
    rpcUrl: params.rpcUrl,
    orchestratorKey: params.orchestratorKey,
    permissionsContext: params.permissionsContext,
    delegationManager: params.delegationManager,
    to: params.marketplaceAddress,
    data
  });

  return { txHash };
}
