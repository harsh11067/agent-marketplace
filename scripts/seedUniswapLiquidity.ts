import { Contract, MaxUint256 } from "ethers";
import { baseSepoliaTokens, baseSepoliaUniswapV2, erc20Abi } from "../src/shared/contracts.ts";
import { createWallet } from "../src/shared/wallet.ts";

const wethAbi = [
  "function deposit() payable",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)"
] as const;

const routerAbi = [
  "function addLiquidity(address tokenA,address tokenB,uint256 amountADesired,uint256 amountBDesired,uint256 amountAMin,uint256 amountBMin,address to,uint256 deadline) returns (uint256 amountA,uint256 amountB,uint256 liquidity)"
] as const;

async function approveIfNeeded(params: {
  tokenAddress: string;
  owner: ReturnType<typeof createWallet>;
  spender: string;
  amount: bigint;
  abi?: readonly string[];
}): Promise<void> {
  const token = new Contract(params.tokenAddress, params.abi ?? erc20Abi, params.owner);
  const allowance = (await token.allowance(params.owner.address, params.spender)) as bigint;
  if (allowance >= params.amount) {
    return;
  }
  const tx = await token.approve(params.spender, MaxUint256);
  await tx.wait();
}

async function main(): Promise<void> {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC ?? "";
  const deployerKey = process.env.DEPLOYER_KEY ?? "";
  if (!rpcUrl || !deployerKey) {
    throw new Error("Missing BASE_SEPOLIA_RPC or DEPLOYER_KEY");
  }

  const deployer = createWallet(deployerKey, rpcUrl);
  const usdc = new Contract(baseSepoliaTokens.USDC, erc20Abi, deployer);
  const weth = new Contract(baseSepoliaTokens.WETH, wethAbi, deployer);
  const router = new Contract(baseSepoliaUniswapV2.router, routerAbi, deployer);

  const amountUsdc = 3_000_000n;
  const amountWeth = 3_000_000_000_000n;

  const wethBalance = (await weth.balanceOf(deployer.address)) as bigint;
  if (wethBalance < amountWeth) {
    const depositTx = await weth.deposit({ value: amountWeth - wethBalance });
    await depositTx.wait();
    console.log(`Wrapped ETH tx=${depositTx.hash}`);
  }

  await approveIfNeeded({
    tokenAddress: baseSepoliaTokens.USDC,
    owner: deployer,
    spender: baseSepoliaUniswapV2.router,
    amount: amountUsdc
  });
  await approveIfNeeded({
    tokenAddress: baseSepoliaTokens.WETH,
    owner: deployer,
    spender: baseSepoliaUniswapV2.router,
    amount: amountWeth,
    abi: wethAbi
  });

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 10);
  const tx = await router.addLiquidity(
    baseSepoliaTokens.USDC,
    baseSepoliaTokens.WETH,
    amountUsdc,
    amountWeth,
    0n,
    0n,
    deployer.address,
    deadline
  );
  const receipt = await tx.wait();
  console.log(`Seeded Base Sepolia Uniswap liquidity tx=${receipt?.hash ?? tx.hash}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
