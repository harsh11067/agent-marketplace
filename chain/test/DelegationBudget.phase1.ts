import { expect } from "chai";
import { ethers } from "hardhat";

describe("DelegationBudget", function () {
  it("registers, tracks spend, and revokes delegations", async function () {
    const [delegator, delegate] = await ethers.getSigners();

    const factory = await ethers.getContractFactory("DelegationBudget");
    const budget = await factory.deploy();
    await budget.waitForDeployment();

    const delegationHash = ethers.keccak256(ethers.toUtf8Bytes("delegation-1"));
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;

    await budget.registerDelegation(delegationHash, delegator.address, delegate.address, 5_000_000n, deadline);

    const state = await budget.delegations(delegationHash);
    expect(state.delegator).to.equal(delegator.address);
    expect(state.delegate).to.equal(delegate.address);
    expect(state.cap).to.equal(5_000_000n);
    expect(state.spent).to.equal(0n);
    expect(state.active).to.equal(true);

    await budget.connect(delegate).recordSpend(delegationHash, 2_000_000n);
    const afterSpend = await budget.delegations(delegationHash);
    expect(afterSpend.spent).to.equal(2_000_000n);

    await expect(
      budget.connect(delegate).recordSpend(delegationHash, 4_000_000n)
    ).to.be.revertedWith("Exceeds cap");

    await budget.connect(delegator).revoke(delegationHash);
    const afterRevoke = await budget.delegations(delegationHash);
    expect(afterRevoke.active).to.equal(false);
  });
});
