import { expect } from "chai";
import { ethers } from "hardhat";

describe("AgentMarketplace Phase 1", function () {
  it("post -> bid -> assign -> complete transfers escrowed USDC", async function () {
    const [deployer, poster, agent] = await ethers.getSigners();

    const usdcFactory = await ethers.getContractFactory("MockUSDC");
    const usdc = await usdcFactory.deploy();
    await usdc.waitForDeployment();

    const reputationFactory = await ethers.getContractFactory("ReputationRegistry");
    const reputation = await reputationFactory.connect(deployer).deploy();
    await reputation.waitForDeployment();

    const marketplaceFactory = await ethers.getContractFactory("AgentMarketplace");
    const marketplace = await marketplaceFactory
      .connect(deployer)
      .deploy(await usdc.getAddress(), await reputation.getAddress());
    await marketplace.waitForDeployment();

    await reputation.connect(deployer).setMarketplace(await marketplace.getAddress());

    const budget = 5_000_000n;
    const agreedPrice = 3_000_000n;
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;

    await usdc.connect(deployer).mint(poster.address, 10_000_000n);
    await usdc.connect(poster).approve(await marketplace.getAddress(), budget);

    await marketplace.connect(poster).postJob("ipfs://task", budget, deadline);

    const postedJob = await marketplace.jobs(1n);
    expect(postedJob.poster).to.equal(poster.address);
    expect(postedJob.budget).to.equal(budget);
    expect(postedJob.status).to.equal(0n); // Open
    expect(await usdc.balanceOf(await marketplace.getAddress())).to.equal(budget);

    await marketplace.connect(agent).submitBid(1n, agreedPrice, "ipfs://bid");
    const bids = await marketplace.getBids(1n);
    expect(bids).to.have.length(1);
    expect(bids[0].agent).to.equal(agent.address);
    expect(bids[0].price).to.equal(agreedPrice);

    await marketplace.connect(poster).assignJob(1n, agent.address, agreedPrice);
    const assignedJob = await marketplace.jobs(1n);
    expect(assignedJob.winner).to.equal(agent.address);
    expect(assignedJob.agreedPrice).to.equal(agreedPrice);
    expect(assignedJob.status).to.equal(1n); // Assigned

    const agentBalanceBefore = await usdc.balanceOf(agent.address);
    const posterBalanceBeforeComplete = await usdc.balanceOf(poster.address);

    await marketplace.connect(agent).completeJob(1n, "ipfs://result");

    const completedJob = await marketplace.jobs(1n);
    expect(completedJob.status).to.equal(2n); // Completed
    expect(completedJob.resultURI).to.equal("ipfs://result");

    expect(await usdc.balanceOf(agent.address)).to.equal(agentBalanceBefore + agreedPrice);
    expect(await usdc.balanceOf(poster.address)).to.equal(
      posterBalanceBeforeComplete + (budget - agreedPrice)
    );
    expect(await usdc.balanceOf(await marketplace.getAddress())).to.equal(0n);
  });
});
