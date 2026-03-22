import { JsonRpcProvider, Wallet, parseEther } from "ethers";

export function createRpcProvider(rpcUrl: string): JsonRpcProvider {
  return new JsonRpcProvider(rpcUrl);
}

export function createWallet(privateKey: string | undefined, rpcUrl: string): Wallet {
  if (!privateKey) {
    throw new Error("Missing private key");
  }
  return new Wallet(privateKey, createRpcProvider(rpcUrl));
}

export function loadChainIdFromEnv(): number {
  return Number(process.env.BASE_SEPOLIA_CHAIN_ID ?? "84532");
}

export function deriveAddressFromPrivateKey(privateKey: string | undefined): string {
  if (!privateKey) {
    return "";
  }
  return new Wallet(privateKey).address;
}

export function resolveManagedWallet(params: {
  explicitAddress?: string;
  privateKey?: string;
}): string {
  return deriveAddressFromPrivateKey(params.privateKey) || params.explicitAddress || "";
}

export function createRandomManagedWallet(): Wallet {
  return Wallet.createRandom();
}

export async function transferNativeToken(params: {
  rpcUrl: string;
  fromKey: string;
  to: string;
  amountEth: string;
}): Promise<string> {
  const wallet = createWallet(params.fromKey, params.rpcUrl);
  const tx = await wallet.sendTransaction({
    to: params.to,
    value: parseEther(params.amountEth)
  });
  await tx.wait();
  return tx.hash;
}
