# AgentFlow — Complete Build Plan
> AI-to-AI Labor Market on Base | Synthesis Hackathon

---

## Target Bounties

| Bounty | Prize | How you win |
|---|---|---|
| Uniswap — Agentic Finance | $5,000 | Real swaps via Uniswap API with real TxIDs on testnet |
| MetaMask — Best Use of Delegations | $5,000 | ERC-7715 sub-delegation chain (user → orchestrator → specialist) |
| Synthesis Open Track | $25,000 | Automatically eligible by submitting a strong project |

---

## Project Overview

AgentFlow is a two-sided marketplace where AI agents post jobs, other AI agents bid, and smart contracts handle escrow and payment — all without human involvement after the user sets the initial task and signs one delegation.

**Core flow:**
1. User sets task + budget, signs ONE MetaMask delegation
2. Orchestrator agent posts the job on-chain (Base Sepolia)
3. Specialist agents read the job, submit bids on-chain
4. Orchestrator picks best bid autonomously
5. Uniswap API settles payment in agent's preferred token
6. Reputation score updates on-chain

---

## Repository Structure

```
agentflow/
├── contracts/
│   ├── AgentMarketplace.sol
│   ├── DelegationBudget.sol
│   └── ReputationRegistry.sol
├── agents/
│   ├── orchestrator/
│   │   ├── index.ts
│   │   ├── jobPoster.ts
│   │   ├── bidEvaluator.ts
│   │   └── delegationManager.ts
│   ├── specialist/
│   │   ├── index.ts
│   │   ├── bidder.ts
│   │   └── taskExecutor.ts
│   └── shared/
│       ├── contracts.ts       (ABI + contract addresses)
│       ├── uniswap.ts         (Uniswap API wrapper)
│       └── wallet.ts          (wallet setup helpers)
├── frontend/
│   ├── index.html
│   ├── jobBoard.ts            (reads on-chain events, shows jobs)
│   └── delegationUI.ts        (MetaMask delegation signing flow)
├── scripts/
│   ├── deploy.ts
│   ├── seedJobs.ts            (creates demo jobs for judges)
│   └── fundAgents.ts          (drip testnet USDC to agent wallets)
├── test/
│   ├── marketplace.test.ts
│   └── delegation.test.ts
├── .env.example
├── hardhat.config.ts
├── package.json
└── README.md
```

---

## Phase 0 — Credentials & Setup (Day 1 morning)

Do this before writing a single line of code. Everything blocks on these.

### 0.1 Get API keys

- [ ] **Uniswap Developer Platform API key**
  - Go to https://developers.uniswap.org
  - Create an account and request an API key
  - This is required for the bounty — no mock, no workaround
  - Can take a few hours to be approved, apply immediately

- [ ] **Alchemy or Infura RPC** for Base Sepolia
  - https://alchemy.com → create app → select Base Sepolia
  - Copy the HTTPS RPC URL

- [ ] **Pinata IPFS** for storing task descriptions and results
  - https://pinata.cloud → free tier is enough
  - Get JWT token

### 0.2 Install tooling

```bash
# Node + package manager
node --version   # needs v18+
npm install -g pnpm

# Hardhat for contracts
pnpm add -D hardhat @nomicfoundation/hardhat-toolbox

# MetaMask gator-cli
npm install -g @metamask/gator-cli

# Verify gator works
gator --version
gator delegation --help
```

### 0.3 Fund wallets

Generate 4 wallets and save private keys in `.env`:

```
DEPLOYER_KEY=0x...         (deploy contracts, fund agents)
ORCHESTRATOR_KEY=0x...     (the orchestrator agent)
SPECIALIST_A_KEY=0x...     (specialist agent 1)
SPECIALIST_B_KEY=0x...     (specialist agent 2)
```

Get Base Sepolia ETH from: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet

Get testnet USDC: deploy a mock ERC-20 or use Circle's testnet USDC faucet.

---

## Phase 1 — Smart Contracts (Day 1 afternoon + Day 2)

### 1.1 AgentMarketplace.sol

The core contract. Handles job posting, bidding, escrow, and completion.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AgentMarketplace is ReentrancyGuard {
    IERC20 public immutable usdc;

    enum JobStatus { Open, Assigned, Completed, Cancelled }

    struct Job {
        address poster;
        string  taskURI;       // IPFS: task description JSON
        uint256 budget;        // USDC amount in escrow
        uint256 deadline;      // unix timestamp
        address winner;
        JobStatus status;
    }

    struct Bid {
        address agent;
        uint256 price;
        string  metadataURI;   // IPFS: agent proof + capability
        uint256 submittedAt;
    }

    mapping(uint256 => Job)    public jobs;
    mapping(uint256 => Bid[])  public bids;
    uint256 public jobCount;

    address public reputationRegistry;

    event JobPosted(uint256 indexed jobId, address indexed poster, uint256 budget);
    event BidSubmitted(uint256 indexed jobId, address indexed agent, uint256 price);
    event JobAssigned(uint256 indexed jobId, address indexed winner);
    event JobCompleted(uint256 indexed jobId, address indexed winner, uint256 payout);
    event JobCancelled(uint256 indexed jobId);

    constructor(address _usdc, address _reputationRegistry) {
        usdc = IERC20(_usdc);
        reputationRegistry = _reputationRegistry;
    }

    function postJob(
        string calldata taskURI,
        uint256 budget,
        uint256 deadline
    ) external returns (uint256 jobId) {
        require(budget > 0, "Budget must be > 0");
        require(deadline > block.timestamp, "Deadline in past");
        usdc.transferFrom(msg.sender, address(this), budget);
        jobId = ++jobCount;
        jobs[jobId] = Job(msg.sender, taskURI, budget, deadline,
                          address(0), JobStatus.Open);
        emit JobPosted(jobId, msg.sender, budget);
    }

    function submitBid(
        uint256 jobId,
        uint256 price,
        string calldata metadataURI
    ) external {
        Job storage job = jobs[jobId];
        require(job.status == JobStatus.Open, "Job not open");
        require(block.timestamp < job.deadline, "Deadline passed");
        require(price <= job.budget, "Bid exceeds budget");
        bids[jobId].push(Bid(msg.sender, price, metadataURI, block.timestamp));
        emit BidSubmitted(jobId, msg.sender, price);
    }

    function assignJob(uint256 jobId, address winner) external {
        Job storage job = jobs[jobId];
        require(msg.sender == job.poster, "Not job poster");
        require(job.status == JobStatus.Open, "Job not open");
        job.winner = winner;
        job.status = JobStatus.Assigned;
        emit JobAssigned(jobId, winner);
    }

    function completeJob(
        uint256 jobId,
        string calldata resultURI    // IPFS: proof of completed task
    ) external nonReentrant {
        Job storage job = jobs[jobId];
        require(msg.sender == job.winner, "Not assigned winner");
        require(job.status == JobStatus.Assigned, "Not assigned");
        job.status = JobStatus.Completed;
        usdc.transfer(job.winner, job.budget);
        IReputationRegistry(reputationRegistry).reward(job.winner);
        emit JobCompleted(jobId, job.winner, job.budget);
    }

    function getBids(uint256 jobId) external view returns (Bid[] memory) {
        return bids[jobId];
    }

    function cancelJob(uint256 jobId) external {
        Job storage job = jobs[jobId];
        require(msg.sender == job.poster, "Not job poster");
        require(job.status == JobStatus.Open, "Can only cancel open jobs");
        job.status = JobStatus.Cancelled;
        usdc.transfer(job.poster, job.budget);
        emit JobCancelled(jobId);
    }
}

interface IReputationRegistry {
    function reward(address agent) external;
}
```

### 1.2 ReputationRegistry.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ReputationRegistry {
    mapping(address => uint256) public score;
    mapping(address => uint256) public completedJobs;
    address public marketplace;

    event ScoreUpdated(address indexed agent, uint256 newScore);

    constructor() {
        marketplace = msg.sender; // set properly via setMarketplace
    }

    function setMarketplace(address _marketplace) external {
        require(marketplace == msg.sender, "Unauthorized");
        marketplace = _marketplace;
    }

    function reward(address agent) external {
        require(msg.sender == marketplace, "Only marketplace");
        score[agent] += 10;
        completedJobs[agent] += 1;
        emit ScoreUpdated(agent, score[agent]);
    }

    function penalize(address agent, uint256 amount) external {
        require(msg.sender == marketplace, "Only marketplace");
        if (score[agent] >= amount) score[agent] -= amount;
        else score[agent] = 0;
    }
}
```

### 1.3 DelegationBudget.sol

Thin contract to verify and track MetaMask ERC-7715 delegations.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Integrates with MetaMask DelegationManager
// The heavy lifting (signature verification) is in MetaMask's contracts
// This contract tracks spending against a delegated budget

contract DelegationBudget {
    struct DelegationState {
        address delegator;
        address delegate;       // the orchestrator agent's smart account
        uint256 cap;            // max USDC allowed to spend
        uint256 spent;
        bool active;
    }

    mapping(bytes32 => DelegationState) public delegations;

    event DelegationRegistered(bytes32 indexed dHash, address delegator, uint256 cap);
    event SpendRecorded(bytes32 indexed dHash, uint256 amount, uint256 totalSpent);

    function registerDelegation(
        bytes32 delegationHash,
        address delegator,
        address delegate,
        uint256 cap
    ) external {
        // In production: verify the EIP-712 signature from delegator
        delegations[delegationHash] = DelegationState(
            delegator, delegate, cap, 0, true
        );
        emit DelegationRegistered(delegationHash, delegator, cap);
    }

    function recordSpend(bytes32 delegationHash, uint256 amount) external {
        DelegationState storage d = delegations[delegationHash];
        require(d.active, "Delegation inactive");
        require(msg.sender == d.delegate, "Not the delegate");
        require(d.spent + amount <= d.cap, "Cap exceeded");
        d.spent += amount;
        emit SpendRecorded(delegationHash, amount, d.spent);
    }

    function revoke(bytes32 delegationHash) external {
        DelegationState storage d = delegations[delegationHash];
        require(msg.sender == d.delegator, "Not delegator");
        d.active = false;
    }
}
```

### 1.4 Hardhat config

```typescript
// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: "0.8.20",
  networks: {
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC!,
      accounts: [process.env.DEPLOYER_KEY!],
      chainId: 84532,
    },
  },
};
export default config;
```

### 1.5 Deploy script

```typescript
// scripts/deploy.ts
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const USDC_ADDRESS = process.env.USDC_ADDRESS!;

  const ReputationRegistry = await ethers.getContractFactory("ReputationRegistry");
  const reputation = await ReputationRegistry.deploy();
  await reputation.waitForDeployment();
  console.log("ReputationRegistry:", await reputation.getAddress());

  const Marketplace = await ethers.getContractFactory("AgentMarketplace");
  const marketplace = await Marketplace.deploy(
    USDC_ADDRESS,
    await reputation.getAddress()
  );
  await marketplace.waitForDeployment();
  console.log("AgentMarketplace:", await marketplace.getAddress());

  await reputation.setMarketplace(await marketplace.getAddress());
  console.log("Marketplace set in reputation registry");

  const DelegationBudget = await ethers.getContractFactory("DelegationBudget");
  const delegation = await DelegationBudget.deploy();
  await delegation.waitForDeployment();
  console.log("DelegationBudget:", await delegation.getAddress());
}

main().catch(console.error);
```

Run:
```bash
npx hardhat run scripts/deploy.ts --network baseSepolia
```

Save the deployed addresses in `.env`:
```
MARKETPLACE_ADDRESS=0x...
REPUTATION_ADDRESS=0x...
DELEGATION_ADDRESS=0x...
```

---

## Phase 2 — Shared Agent Utilities (Day 2)

### 2.1 Wallet setup (agents/shared/wallet.ts)

```typescript
import { ethers } from "ethers";

export function getProvider() {
  return new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC!);
}

export function getWallet(privateKey: string) {
  return new ethers.Wallet(privateKey, getProvider());
}

export const orchestratorWallet = getWallet(process.env.ORCHESTRATOR_KEY!);
export const specialistAWallet  = getWallet(process.env.SPECIALIST_A_KEY!);
export const specialistBWallet  = getWallet(process.env.SPECIALIST_B_KEY!);
```

### 2.2 Contract bindings (agents/shared/contracts.ts)

```typescript
import { ethers } from "ethers";
import MarketplaceABI from "../../artifacts/contracts/AgentMarketplace.sol/AgentMarketplace.json";
import ReputationABI  from "../../artifacts/contracts/ReputationRegistry.sol/ReputationRegistry.json";

export function getMarketplace(signer: ethers.Signer) {
  return new ethers.Contract(
    process.env.MARKETPLACE_ADDRESS!,
    MarketplaceABI.abi,
    signer
  );
}

export function getReputation(signer: ethers.Signer) {
  return new ethers.Contract(
    process.env.REPUTATION_ADDRESS!,
    ReputationABI.abi,
    signer
  );
}
```

### 2.3 IPFS helper (agents/shared/ipfs.ts)

```typescript
import axios from "axios";

const PINATA_JWT = process.env.PINATA_JWT!;

export async function uploadToIPFS(data: object): Promise<string> {
  const res = await axios.post(
    "https://api.pinata.cloud/pinning/pinJSONToIPFS",
    { pinataContent: data },
    { headers: { Authorization: `Bearer ${PINATA_JWT}` } }
  );
  return `ipfs://${res.data.IpfsHash}`;
}

export async function fetchFromIPFS(uri: string): Promise<any> {
  const hash = uri.replace("ipfs://", "");
  const res = await axios.get(`https://gateway.pinata.cloud/ipfs/${hash}`);
  return res.data;
}
```

### 2.4 Uniswap payment (agents/shared/uniswap.ts)

```typescript
// Uses the Uniswap API to settle agent payments
// This is what satisfies the "real TxIDs" Uniswap bounty requirement

const UNISWAP_API_BASE = "https://trade-api.gateway.uniswap.org/v1";
const UNISWAP_API_KEY  = process.env.UNISWAP_API_KEY!;

export async function getSwapQuote(params: {
  tokenIn:  string;   // token address
  tokenOut: string;
  amount:   string;   // in wei
  walletAddress: string;
}) {
  const res = await fetch(`${UNISWAP_API_BASE}/quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": UNISWAP_API_KEY,
    },
    body: JSON.stringify({
      tokenInChainId:  84532,   // Base Sepolia
      tokenOutChainId: 84532,
      tokenIn:  params.tokenIn,
      tokenOut: params.tokenOut,
      amount:   params.amount,
      swapper:  params.walletAddress,
      type:     "EXACT_INPUT",
    }),
  });
  return res.json();
}

export async function executeSwap(quote: any, signer: any) {
  // Submit the quoted order to Uniswap
  const res = await fetch(`${UNISWAP_API_BASE}/order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": UNISWAP_API_KEY,
    },
    body: JSON.stringify({ quote, signature: await signer.signTypedData(
      quote.permitData.domain,
      quote.permitData.types,
      quote.permitData.values
    )}),
  });
  const result = await res.json();
  console.log("Uniswap order hash:", result.orderHash);
  return result;
}
```

---

## Phase 3 — Orchestrator Agent (Day 3)

The orchestrator receives the user's task, posts it on-chain, reads bids, and picks the winner.

### 3.1 Main orchestrator (agents/orchestrator/index.ts)

```typescript
import { orchestratorWallet } from "../shared/wallet";
import { getMarketplace }     from "../shared/contracts";
import { uploadToIPFS }       from "../shared/ipfs";
import { evaluateBids }       from "./bidEvaluator";

const marketplace = getMarketplace(orchestratorWallet);

export async function handleTask(task: {
  description: string;
  budget: number;       // USDC, human-readable (e.g. 5 = $5)
  deadline: number;     // unix timestamp
}) {
  console.log(`[Orchestrator] Posting job: "${task.description}"`);

  // 1. Upload task to IPFS
  const taskURI = await uploadToIPFS({
    description: task.description,
    postedAt: Date.now(),
    poster: orchestratorWallet.address,
  });

  // 2. Approve USDC spend
  const budgetWei = BigInt(task.budget) * BigInt(1_000_000); // USDC 6 decimals
  // (approve USDC contract first — see Phase 5)

  // 3. Post job on-chain
  const tx = await marketplace.postJob(taskURI, budgetWei, task.deadline);
  const receipt = await tx.wait();
  const jobId = extractJobId(receipt);
  console.log(`[Orchestrator] Job posted. ID: ${jobId}, TxHash: ${receipt.hash}`);

  // 4. Wait for bids (poll for 30 seconds in demo)
  await new Promise(r => setTimeout(r, 30_000));

  // 5. Read and evaluate bids
  const bids = await marketplace.getBids(jobId);
  if (bids.length === 0) {
    console.log("[Orchestrator] No bids received.");
    return;
  }

  const winner = await evaluateBids(bids, task.description);
  console.log(`[Orchestrator] Picked winner: ${winner}`);

  // 6. Assign job on-chain
  const assignTx = await marketplace.assignJob(jobId, winner);
  await assignTx.wait();
  console.log(`[Orchestrator] Job assigned. TxHash: ${assignTx.hash}`);
}

function extractJobId(receipt: any): number {
  const event = receipt.logs.find((l: any) => l.fragment?.name === "JobPosted");
  return Number(event?.args?.jobId);
}
```

### 3.2 Bid evaluator — this is where the LLM lives (agents/orchestrator/bidEvaluator.ts)

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { fetchFromIPFS } from "../shared/ipfs";

const claude = new Anthropic();

export async function evaluateBids(bids: any[], taskDescription: string): Promise<string> {
  // Fetch each agent's capability metadata from IPFS
  const enriched = await Promise.all(
    bids.map(async (bid) => ({
      agent: bid.agent,
      price: Number(bid.price) / 1_000_000,
      metadata: await fetchFromIPFS(bid.metadataURI).catch(() => ({})),
    }))
  );

  // Ask Claude to pick the best bid
  const response = await claude.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `You are an AI orchestrator. Pick the best agent for this task.
      
Task: ${taskDescription}

Bids:
${enriched.map((b, i) =>
  `${i+1}. Agent ${b.agent} — $${b.price} USDC — Capabilities: ${JSON.stringify(b.metadata)}`
).join("\n")}

Reply with ONLY the winning agent's wallet address. Nothing else.`
    }]
  });

  const winner = (response.content[0] as any).text.trim();
  return winner;
}
```

---

## Phase 4 — Specialist Agent (Day 3)

The specialist polls for open jobs, decides if it can do them, submits a bid, and executes if assigned.

### 4.1 Main specialist (agents/specialist/index.ts)

```typescript
import { specialistAWallet } from "../shared/wallet";
import { getMarketplace }    from "../shared/contracts";
import { uploadToIPFS, fetchFromIPFS } from "../shared/ipfs";
import { executeTask }       from "./taskExecutor";

const marketplace = getMarketplace(specialistAWallet);

const MY_CAPABILITIES = {
  skills: ["url-fetch", "summarize", "web-search"],
  model:  "claude-sonnet",
  avgCompletionTime: "30s",
};

async function pollAndBid() {
  console.log("[Specialist A] Polling for jobs...");

  // Listen for JobPosted events
  marketplace.on("JobPosted", async (jobId, poster, budget) => {
    console.log(`[Specialist A] New job #${jobId} — budget: ${budget}`);

    const job = await marketplace.jobs(jobId);
    const task = await fetchFromIPFS(job.taskURI).catch(() => null);
    if (!task) return;

    // Decide if we can do this task
    const canDo = task.description.toLowerCase().includes("summarize") ||
                  task.description.toLowerCase().includes("fetch");
    if (!canDo) return;

    // Upload capability proof to IPFS
    const metadataURI = await uploadToIPFS({
      ...MY_CAPABILITIES,
      bidder: specialistAWallet.address,
      forJob: jobId.toString(),
    });

    // Bid at 60% of budget
    const bidPrice = (BigInt(budget) * 60n) / 100n;
    const tx = await marketplace.submitBid(jobId, bidPrice, metadataURI);
    await tx.wait();
    console.log(`[Specialist A] Bid submitted. TxHash: ${tx.hash}`);
  });

  // Listen for JobAssigned — if we won, execute the task
  marketplace.on("JobAssigned", async (jobId, winner) => {
    if (winner.toLowerCase() !== specialistAWallet.address.toLowerCase()) return;
    console.log(`[Specialist A] Won job #${jobId}! Executing...`);

    const job  = await marketplace.jobs(jobId);
    const task = await fetchFromIPFS(job.taskURI);
    const result = await executeTask(task.description);

    const resultURI = await uploadToIPFS({ result, completedAt: Date.now() });
    const tx = await marketplace.completeJob(jobId, resultURI);
    await tx.wait();
    console.log(`[Specialist A] Job completed. TxHash: ${tx.hash}`);
  });
}

pollAndBid().catch(console.error);
```

### 4.2 Task executor — actually does the work (agents/specialist/taskExecutor.ts)

```typescript
import Anthropic from "@anthropic-ai/sdk";

const claude = new Anthropic();

export async function executeTask(description: string): Promise<string> {
  const response = await claude.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [{
      role: "user",
      content: `Complete this task and return only the result, no preamble:

${description}`
    }]
  });
  return (response.content[0] as any).text;
}
```

---

## Phase 5 — MetaMask Delegation Flow (Day 4)

This is what wins the MetaMask bounty. The user signs once; the orchestrator spends within the delegated budget.

### 5.1 Install gator-cli and Smart Accounts Kit

```bash
npm install @metamask/gator-cli
npm install @metamask/smart-accounts-kit
npm install @metamask/delegation-framework
```

### 5.2 User-side: Create and sign a delegation (frontend/delegationUI.ts)

```typescript
import { createDelegation, signDelegation } from "@metamask/delegation-framework";

export async function createUserDelegation(params: {
  orchestratorSmartAccount: string;  // the orchestrator's ERC-4337 address
  budgetUsdc: number;
  deadlineTimestamp: number;
}) {
  const delegation = createDelegation({
    delegate:  params.orchestratorSmartAccount,
    delegator: "user_address_from_metamask",
    caveats: [
      {
        enforcer: "NativeTokenPaymentEnforcer",   // limits USDC spend
        terms: encodeBudgetCaveat(params.budgetUsdc),
      },
      {
        enforcer: "TimestampEnforcer",
        terms: encodeDeadlineCaveat(params.deadlineTimestamp),
      }
    ]
  });

  // User signs this in MetaMask — one signature, that's it
  const signedDelegation = await signDelegation(delegation);
  return signedDelegation;
}
```

### 5.3 Orchestrator-side: Use the delegation to pay for jobs

```typescript
import { executeDelegation } from "@metamask/delegation-framework";

export async function payForJobWithDelegation(
  signedDelegation: any,
  amount: bigint,
  recipient: string
) {
  // Orchestrator redeems the delegation to transfer USDC to the marketplace
  const tx = await executeDelegation({
    delegation: signedDelegation,
    action: {
      to:    process.env.MARKETPLACE_ADDRESS!,
      value: 0n,
      data:  encodeApproveAndPost(amount),
    }
  });
  console.log("Delegation executed. TxHash:", tx.hash);
  return tx;
}
```

### 5.4 Sub-delegation: Orchestrator delegates budget to specialist

```typescript
// Once the orchestrator has a delegation from the user,
// it can issue a smaller sub-delegation to the specialist

export async function createSubDelegation(
  parentDelegation: any,
  specialistAddress: string,
  subBudget: bigint
) {
  const subDelegation = createDelegation({
    delegate:  specialistAddress,
    delegator: orchestratorSmartAccount.address,
    caveats: [{
      enforcer: "NativeTokenPaymentEnforcer",
      terms: encodeBudgetCaveat(subBudget),
    }],
    parentDelegation,   // chain it to the user's original delegation
  });

  return signDelegation(subDelegation, orchestratorSmartAccount);
}
```

---

## Phase 6 — Uniswap Integration (Day 5)

The payment release goes through Uniswap. This gives you real TxIDs on testnet, which is mandatory for the bounty.

### 6.1 Payment flow

When the specialist completes a job, instead of the marketplace directly transferring USDC:

1. Marketplace releases USDC to an intermediary
2. Agent calls Uniswap API to get a quote (e.g. USDC → ETH, or USDC → any preferred token)
3. Agent signs and submits the Uniswap order
4. Uniswap executes the swap on-chain
5. Agent receives preferred token — real TxID generated

### 6.2 Settlement script (agents/shared/uniswap.ts)

See Phase 2.4 above for the full implementation. Key endpoints:
- `POST /v1/quote` — get a swap quote
- `POST /v1/order` — submit the signed order
- `GET /v1/order/{hash}` — poll for settlement status

### 6.3 Token addresses on Base Sepolia

```typescript
export const TOKENS = {
  USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",  // Circle testnet USDC
  WETH: "0x4200000000000000000000000000000000000006",   // Wrapped ETH on Base
};
```

---

## Phase 7 — Frontend Job Board (Day 5–6)

A minimal page that shows jobs, bids, and completed work so judges can see the whole flow.

### 7.1 index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AgentFlow — AI Labor Market</title>
  <style>
    body { font-family: monospace; max-width: 900px; margin: 40px auto; padding: 0 20px; }
    h1 { color: #00ff88; }
    .job { border: 1px solid #333; padding: 16px; margin: 12px 0; border-radius: 8px; }
    .open { border-color: #00ff88; }
    .completed { border-color: #888; opacity: 0.7; }
    .badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; }
    .open-badge { background: #003322; color: #00ff88; }
    .done-badge { background: #222; color: #888; }
    button { background: #00ff88; color: #000; border: none; padding: 8px 16px;
             cursor: pointer; border-radius: 4px; font-weight: bold; }
  </style>
</head>
<body>
  <h1>⚡ AgentFlow</h1>
  <p>AI-to-AI labor market on Base</p>
  <button onclick="postDemoJob()">Post Demo Job</button>
  <div id="jobs"></div>
  <script type="module" src="jobBoard.js"></script>
</body>
</html>
```

### 7.2 Job board (frontend/jobBoard.ts)

```typescript
import { ethers } from "ethers";
import { getMarketplace } from "../agents/shared/contracts";

const provider = new ethers.BrowserProvider(window.ethereum);

async function loadJobs() {
  const signer      = await provider.getSigner();
  const marketplace = getMarketplace(signer);

  const filter = marketplace.filters.JobPosted();
  const events = await marketplace.queryFilter(filter, -10000);

  const container = document.getElementById("jobs")!;
  container.innerHTML = "";

  for (const event of events.reverse()) {
    const jobId = (event as any).args.jobId;
    const job   = await marketplace.jobs(jobId);
    const bids  = await marketplace.getBids(jobId);

    const div = document.createElement("div");
    div.className = `job ${job.status === 2n ? "completed" : "open"}`;
    div.innerHTML = `
      <strong>Job #${jobId}</strong>
      <span class="badge ${job.status === 2n ? "done-badge" : "open-badge"}">
        ${["Open", "Assigned", "Completed", "Cancelled"][Number(job.status)]}
      </span>
      <p>Budget: $${Number(job.budget) / 1_000_000} USDC</p>
      <p>Bids: ${bids.length}</p>
      <p>Task: <a href="https://gateway.pinata.cloud/ipfs/${job.taskURI.replace('ipfs://', '')}" 
         target="_blank">View on IPFS</a></p>
      <p style="font-size:11px;color:#888">
        Tx: ${(event as any).transactionHash}
      </p>
    `;
    container.appendChild(div);
  }
}

loadJobs();
setInterval(loadJobs, 10000);
```

---

## Phase 8 — Demo Seed Script (Day 6)

Run this to pre-populate jobs so the demo looks alive when judges visit.

```typescript
// scripts/seedJobs.ts
import { orchestratorWallet, specialistAWallet } from "../agents/shared/wallet";
import { getMarketplace } from "../agents/shared/contracts";
import { uploadToIPFS }   from "../agents/shared/ipfs";

const marketplace = getMarketplace(orchestratorWallet);

const DEMO_TASKS = [
  { description: "Summarize the Uniswap v4 whitepaper in 3 bullet points", budget: 3 },
  { description: "Fetch ETH price from CoinGecko and return JSON",          budget: 1 },
  { description: "Write a haiku about decentralized finance",                budget: 2 },
];

async function seed() {
  for (const task of DEMO_TASKS) {
    const taskURI    = await uploadToIPFS(task);
    const budgetWei  = BigInt(task.budget) * 1_000_000n;
    const deadline   = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const tx = await marketplace.postJob(taskURI, budgetWei, deadline);
    await tx.wait();
    console.log(`Posted: "${task.description}" — TxHash: ${tx.hash}`);
  }
}

seed().catch(console.error);
```

---

## Phase 9 — Testing (Day 6)

### 9.1 Contract tests (test/marketplace.test.ts)

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";

describe("AgentMarketplace", () => {
  let marketplace: any, usdc: any, reputation: any;
  let poster: any, specialist: any;

  beforeEach(async () => {
    [poster, specialist] = await ethers.getSigners();

    const USDC = await ethers.getContractFactory("MockUSDC");
    usdc = await USDC.deploy();

    const Reputation = await ethers.getContractFactory("ReputationRegistry");
    reputation = await Reputation.deploy();

    const Marketplace = await ethers.getContractFactory("AgentMarketplace");
    marketplace = await Marketplace.deploy(
      await usdc.getAddress(),
      await reputation.getAddress()
    );

    await reputation.setMarketplace(await marketplace.getAddress());
    await usdc.mint(poster.address, 1000_000000n);
    await usdc.connect(poster).approve(await marketplace.getAddress(), 1000_000000n);
  });

  it("posts a job and holds budget in escrow", async () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    await marketplace.connect(poster).postJob("ipfs://test", 5_000000n, deadline);
    const job = await marketplace.jobs(1);
    expect(job.status).to.equal(0); // Open
    expect(job.budget).to.equal(5_000000n);
  });

  it("full flow: post → bid → assign → complete → payment released", async () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    await marketplace.connect(poster).postJob("ipfs://test", 5_000000n, deadline);
    await marketplace.connect(specialist).submitBid(1, 3_000000n, "ipfs://bid");
    await marketplace.connect(poster).assignJob(1, specialist.address);
    await marketplace.connect(specialist).completeJob(1, "ipfs://result");

    const job = await marketplace.jobs(1);
    expect(job.status).to.equal(2); // Completed

    const balance = await usdc.balanceOf(specialist.address);
    expect(balance).to.equal(5_000000n); // full budget released
  });
});
```

Run tests:
```bash
npx hardhat test
```

---

## Environment Variables

Create `.env` in the project root:

```bash
# RPC
BASE_SEPOLIA_RPC=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY

# Wallets (generate with: node -e "console.log(require('ethers').Wallet.createRandom().privateKey)")
DEPLOYER_KEY=0x...
ORCHESTRATOR_KEY=0x...
SPECIALIST_A_KEY=0x...
SPECIALIST_B_KEY=0x...

# Deployed contracts (fill after Phase 1)
MARKETPLACE_ADDRESS=0x...
REPUTATION_ADDRESS=0x...
DELEGATION_ADDRESS=0x...
USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e

# External APIs
UNISWAP_API_KEY=your_key_here
PINATA_JWT=your_jwt_here
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Day-by-Day Schedule

| Day | Focus | Deliverable |
|---|---|---|
| 1 AM | Phase 0 — Credentials, tooling, wallets | All API keys in hand, testnet ETH funded |
| 1 PM | Phase 1 — Write + deploy contracts | 3 contracts live on Base Sepolia, addresses saved |
| 2 | Phase 2 — Shared utilities | Wallet, IPFS, Uniswap, contract bindings working |
| 3 | Phases 3 & 4 — Orchestrator + Specialist agents | End-to-end job flow working locally |
| 4 | Phase 5 — MetaMask delegation | User signs delegation, orchestrator spends from it |
| 5 | Phase 6 + 7 — Uniswap payment + frontend | Real Uniswap TxID generated, job board visible |
| 6 | Phase 8 + 9 — Seed + tests | Demo data live, tests passing, README finalized |
| 7 | Polish | Record 2-min demo video, submit |

---

## Submission Checklist

- [ ] All contracts deployed on Base Sepolia — addresses in README
- [ ] At least 3 complete job flows with real TxIDs on testnet
- [ ] Uniswap swap TxID for at least one payment (mandatory for bounty)
- [ ] MetaMask delegation used — show the signed delegation hash
- [ ] Public GitHub repo with README
- [ ] IPFS hashes for task descriptions and results are real and fetchable
- [ ] Demo video (2 minutes): user → job posted → bid → assigned → completed → paid
- [ ] Frontend URL where judges can see the live job board
- [ ] No mocks, no workarounds, no hardcoded results
- [x] Implement Figma Design (CRM)
- [x] Integrate Spline 3D

---

## README Template (for submission)

```markdown
# AgentFlow — AI-to-AI Labor Market

## What it does
AI agents hire other AI agents to complete tasks. Users set a task 
and budget, sign one MetaMask delegation, then walk away. 
Orchestrator agents post jobs, specialist agents bid, smart contracts 
handle escrow, and Uniswap settles payment — fully autonomous.

## Live Demo
Frontend: [your-url]
Contract (Base Sepolia): [marketplace address]
Demo TxIDs: [link to Basescan]

## Bounties targeted
- Uniswap Agentic Finance — real swaps, real TxIDs on testnet
- MetaMask Best Use of Delegations — ERC-7715 sub-delegation chain

## Tech stack
Base Sepolia · Solidity 0.8.20 · MetaMask Delegation Framework (ERC-7715) ·
Uniswap API · Claude API · IPFS (Pinata) · TypeScript · Hardhat

## How it works
[architecture diagram or image]

1. User sets task + budget, signs ONE MetaMask delegation
2. Orchestrator agent posts job on-chain
3. Specialist agents bid
4. Claude (orchestrator brain) evaluates bids, picks winner
5. Uniswap API settles payment in agent's preferred token
6. Reputation updates on-chain

## Run locally
git clone ...
cp .env.example .env   # fill in keys
pnpm install
npx hardhat test
npx hardhat run scripts/deploy.ts --network baseSepolia
pnpm run orchestrator
pnpm run specialist
```

---

## Resources

- Uniswap API docs: https://developers.uniswap.org/contracts/v4/overview
- Uniswap AI Skills: https://docs.uniswap.org/sdk/ai-skills
- MetaMask gator-cli: https://github.com/metamask/gator-cli
- MetaMask Delegation Framework: https://github.com/metamask/delegation-framework
- Base Sepolia faucet: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet
- Base Sepolia explorer: https://sepolia.basescan.org
- Pinata IPFS: https://pinata.cloud
- OpenZeppelin contracts: https://github.com/OpenZeppelin/openzeppelin-contracts
