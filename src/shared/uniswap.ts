import { Contract, MaxUint256, Wallet } from "ethers";
import { createWallet } from "./wallet.ts";
import { baseSepoliaTokens, baseSepoliaUniswapV2, erc20Abi } from "./contracts.ts";

const UNISWAP_API_BASE = process.env.UNISWAP_API_BASE ?? "https://trade-api.gateway.uniswap.org/v1";
const uniswapV2RouterAbi = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) returns (uint256[] memory amounts)"
] as const;

export type UniswapQuoteParams = {
  tokenInAddress: string;
  tokenOutAddress: string;
  amount: string;
  walletAddress: string;
  tokenInChainId?: number;
  tokenOutChainId?: number;
};

export type UniswapQuoteResponse = {
  quoteId?: string;
  requestId?: string;
  amountIn?: string;
  amountOut?: string;
  routing?: string;
  permitData?: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    values: Record<string, unknown>;
  };
  swap?: {
    to: string;
    from: string;
    data: string;
    value: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    gasLimit?: string;
  };
  [key: string]: unknown;
};

export type UniswapExecutionResult = {
  orderId?: string;
  orderHash?: string;
  txHash?: string;
  [key: string]: unknown;
};

type DirectSwapFallbackParams = {
  wallet: Wallet;
  tokenInAddress: string;
  tokenOutAddress: string;
  amount: string;
};

type UniswapOrderStatus = {
  orderStatus?: string;
  txHash?: string;
  orderHash?: string;
  orderId?: string;
  encodedOrder?: string;
};

function getHeaders(): Record<string, string> {
  const apiKey = process.env.UNISWAP_API_KEY ?? "";
  if (!apiKey) {
    throw new Error("Missing UNISWAP_API_KEY");
  }

  return {
    "content-type": "application/json",
    "x-api-key": apiKey
  };
}

export function isUniswapConfigured(): boolean {
  return Boolean(process.env.UNISWAP_API_KEY);
}

export async function getUniswapQuote(params: UniswapQuoteParams): Promise<UniswapQuoteResponse> {
  const response = await fetch(`${UNISWAP_API_BASE}/quote`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      type: "EXACT_INPUT",
      tokenInChainId: params.tokenInChainId ?? 84532,
      tokenOutChainId: params.tokenOutChainId ?? 84532,
      tokenIn: params.tokenInAddress,
      tokenOut: params.tokenOutAddress,
      amount: params.amount,
      swapper: params.walletAddress,
      slippageTolerance: 1.5,
      urgency: "normal"
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Uniswap quote failed: ${response.status} ${text}`);
  }

  return (await response.json()) as UniswapQuoteResponse;
}

export async function executeUniswapOrder(params: {
  quote: UniswapQuoteResponse;
  signature?: string;
}): Promise<UniswapExecutionResult> {
  const response = await fetch(`${UNISWAP_API_BASE}/order`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      quote: params.quote,
      signature: params.signature
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Uniswap execution failed: ${response.status} ${text}`);
  }

  return (await response.json()) as UniswapExecutionResult;
}

export async function createUniswapSwap(params: {
  quote: UniswapQuoteResponse;
  signature?: string;
}): Promise<UniswapExecutionResult> {
  const response = await fetch(`${UNISWAP_API_BASE}/swap`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      quote: params.quote,
      signature: params.signature
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Uniswap swap failed: ${response.status} ${text}`);
  }

  return (await response.json()) as UniswapExecutionResult;
}

export async function getUniswapOrderStatus(orderIdOrHash: string): Promise<UniswapOrderStatus | null> {
  const tryRefs = [
    `${UNISWAP_API_BASE}/orders?orderId=${encodeURIComponent(orderIdOrHash)}`,
    `${UNISWAP_API_BASE}/orders?orderHash=${encodeURIComponent(orderIdOrHash)}`,
    `${UNISWAP_API_BASE}/order/${encodeURIComponent(orderIdOrHash)}`
  ];

  for (const ref of tryRefs) {
    const response = await fetch(ref, {
      method: "GET",
      headers: { "x-api-key": process.env.UNISWAP_API_KEY ?? "" }
    }).catch(() => null);
    if (!response || !response.ok) {
      continue;
    }
    const payload = (await response.json()) as { orders?: UniswapOrderStatus[] } & UniswapOrderStatus;
    if (Array.isArray(payload.orders) && payload.orders[0]) {
      return payload.orders[0];
    }
    return payload;
  }

  return null;
}

export async function signUniswapPermit(params: {
  wallet: Wallet;
  quote: UniswapQuoteResponse;
}): Promise<string | undefined> {
  const permitData = params.quote.permitData;
  if (!permitData) {
    return undefined;
  }

  const domain = permitData.domain as Parameters<Wallet["signTypedData"]>[0];
  const types = { ...(permitData.types as Parameters<Wallet["signTypedData"]>[1]) };
  delete (types as Record<string, unknown>).EIP712Domain;
  const values = permitData.values as Parameters<Wallet["signTypedData"]>[2];
  return params.wallet.signTypedData(domain, types, values);
}

async function approveRouterIfNeeded(params: {
  wallet: Wallet;
  tokenAddress: string;
  spender: string;
  amount: bigint;
}): Promise<void> {
  const token = new Contract(params.tokenAddress, erc20Abi, params.wallet);
  const allowance = (await token.allowance(params.wallet.address, params.spender)) as bigint;
  if (allowance >= params.amount) {
    return;
  }
  const tx = await token.approve(params.spender, MaxUint256);
  await tx.wait();
}

async function settleViaDirectRouterFallback(
  params: DirectSwapFallbackParams
): Promise<UniswapExecutionResult> {
  const chainId = Number((await params.wallet.provider?.getNetwork())?.chainId ?? 0);
  if (chainId !== 84532) {
    throw new Error("Direct Uniswap fallback is only configured for Base Sepolia");
  }

  if (
    params.tokenInAddress.toLowerCase() !== baseSepoliaTokens.USDC.toLowerCase()
    || params.tokenOutAddress.toLowerCase() !== baseSepoliaTokens.WETH.toLowerCase()
  ) {
    throw new Error("Direct Uniswap fallback only supports Base Sepolia USDC -> WETH");
  }

  const router = new Contract(baseSepoliaUniswapV2.router, uniswapV2RouterAbi, params.wallet);
  const amountIn = BigInt(params.amount);
  await approveRouterIfNeeded({
    wallet: params.wallet,
    tokenAddress: params.tokenInAddress,
    spender: baseSepoliaUniswapV2.router,
    amount: amountIn
  });

  const path = [params.tokenInAddress, params.tokenOutAddress];
  const amounts = (await router.getAmountsOut(amountIn, path)) as bigint[];
  const quotedOut = amounts[amounts.length - 1] ?? 0n;
  const amountOutMin = quotedOut > 0n ? (quotedOut * 90n) / 100n : 0n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 10);
  const tx = await router.swapExactTokensForTokens(
    amountIn,
    amountOutMin,
    path,
    params.wallet.address,
    deadline
  );
  await tx.wait();
  return {
    txHash: tx.hash,
    orderId: "uniswap-v2-direct",
    amountOut: quotedOut.toString()
  };
}

export async function settleUniswapPayout(params: {
  rpcUrl: string;
  walletKey: string;
  tokenInAddress: string;
  tokenOutAddress: string;
  amount: string;
}): Promise<UniswapExecutionResult> {
  const wallet = createWallet(params.walletKey, params.rpcUrl);

  if (params.tokenInAddress.toLowerCase() === params.tokenOutAddress.toLowerCase()) {
    return { txHash: undefined, orderId: "direct-transfer" };
  }

  try {
    const quote = await getUniswapQuote({
      tokenInAddress: params.tokenInAddress,
      tokenOutAddress: params.tokenOutAddress,
      amount: params.amount,
      walletAddress: wallet.address
    });
    const signature = await signUniswapPermit({ wallet, quote });

    if (quote.swap?.to && quote.swap.data) {
      const tx = await wallet.sendTransaction({
        to: quote.swap.to,
        data: quote.swap.data,
        value: BigInt(quote.swap.value ?? "0"),
        maxFeePerGas: quote.swap.maxFeePerGas ? BigInt(quote.swap.maxFeePerGas) : undefined,
        maxPriorityFeePerGas: quote.swap.maxPriorityFeePerGas ? BigInt(quote.swap.maxPriorityFeePerGas) : undefined,
        gasLimit: quote.swap.gasLimit ? BigInt(quote.swap.gasLimit) : undefined
      });
      await tx.wait();
      return { txHash: tx.hash, orderId: quote.quoteId ?? quote.requestId };
    }

    const order = await executeUniswapOrder({ quote, signature });
    const orderRef = order.orderId ?? order.orderHash;
    if (!orderRef) {
      return order;
    }

    const started = Date.now();
    while (Date.now() - started < 120_000) {
      const status = await getUniswapOrderStatus(orderRef);
      if (status?.txHash) {
        return {
          ...order,
          txHash: status.txHash,
          orderId: status.orderId ?? order.orderId,
          orderHash: status.orderHash ?? order.orderHash
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }

    return order;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("No quotes available")
      || message.includes("404")
      || message.includes("ResourceNotFound")
    ) {
      return settleViaDirectRouterFallback({
        wallet,
        tokenInAddress: params.tokenInAddress,
        tokenOutAddress: params.tokenOutAddress,
        amount: params.amount
      });
    }
    throw error;
  }
}
