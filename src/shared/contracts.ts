export const agentMarketplaceAbi = [
  "function postJob(string taskURI, uint256 budget, uint256 deadline) returns (uint256 jobId)",
  "function submitBid(uint256 jobId, uint256 price, string metadataURI)",
  "function assignJob(uint256 jobId, address winner, uint256 agreedPrice)",
  "function completeJob(uint256 jobId, string resultURI)",
  "function jobCount() view returns (uint256)",
  "function getBids(uint256 jobId) view returns (tuple(address agent,uint256 price,string metadataURI,uint256 submittedAt)[])",
  "function jobs(uint256 jobId) view returns (tuple(address poster,string taskURI,uint256 budget,uint256 deadline,address winner,uint256 agreedPrice,uint8 status,string resultURI))"
] as const;

export const delegationBudgetAbi = [
  "function registerDelegation(bytes32 delegationHash, address delegator, address delegate, uint256 cap, uint256 deadline)",
  "function recordSpend(bytes32 delegationHash, uint256 amount)",
  "function revoke(bytes32 delegationHash)",
  "function delegations(bytes32 delegationHash) view returns (tuple(address delegator,address delegate,uint256 cap,uint256 spent,uint256 deadline,bool active))"
] as const;

export const erc20Abi = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)"
] as const;

export type AgentflowAddresses = {
  marketplaceAddress: string;
  reputationAddress?: string;
  delegationBudgetAddress?: string;
  usdcAddress: string;
};

export function loadAgentflowAddressesFromEnv(): AgentflowAddresses {
  return {
    marketplaceAddress: process.env.AGENTFLOW_MARKETPLACE_ADDRESS ?? "",
    reputationAddress: process.env.AGENTFLOW_REPUTATION_ADDRESS ?? "",
    delegationBudgetAddress: process.env.AGENTFLOW_DELEGATION_BUDGET_ADDRESS ?? "",
    usdcAddress: process.env.AGENTFLOW_USDC_ADDRESS ?? process.env.USDC_ADDRESS ?? ""
  };
}

export const baseSepoliaTokens = {
  USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  WETH: "0x4200000000000000000000000000000000000006"
} as const;

export const baseSepoliaUniswapV2 = {
  router: "0x1689E7B1F10000AE47eBfE339a4f69dECd19F602",
  factory: "0x7Ae58f10f7849cA6F5fB71b7f45CB416c9204b1e"
} as const;
