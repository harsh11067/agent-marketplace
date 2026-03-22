import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const usdc = process.env.USDC_ADDRESS;
  if (!usdc) {
    throw new Error("Missing USDC_ADDRESS in env");
  }

  const ReputationRegistry = await ethers.getContractFactory("ReputationRegistry");
  const reputation = await ReputationRegistry.deploy();
  await reputation.waitForDeployment();
  const reputationAddress = await reputation.getAddress();
  console.log("ReputationRegistry:", reputationAddress);

  const DelegationBudget = await ethers.getContractFactory("DelegationBudget");
  const delegationBudget = await DelegationBudget.deploy();
  await delegationBudget.waitForDeployment();
  const delegationBudgetAddress = await delegationBudget.getAddress();
  console.log("DelegationBudget:", delegationBudgetAddress);

  const Marketplace = await ethers.getContractFactory("AgentMarketplace");
  const marketplace = await Marketplace.deploy(usdc, reputationAddress);
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log("AgentMarketplace:", marketplaceAddress);

  await reputation.setMarketplace(marketplaceAddress);
  console.log("ReputationRegistry marketplace set:", marketplaceAddress);

  console.log("\nAdd to your app .env:");
  console.log(`BASE_SEPOLIA_RPC=${process.env.BASE_SEPOLIA_RPC ?? ""}`);
  console.log(`AGENTFLOW_MARKETPLACE_ADDRESS=${marketplaceAddress}`);
  console.log(`AGENTFLOW_REPUTATION_ADDRESS=${reputationAddress}`);
  console.log(`AGENTFLOW_DELEGATION_BUDGET_ADDRESS=${delegationBudgetAddress}`);
  console.log(`AGENTFLOW_USDC_ADDRESS=${usdc}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

