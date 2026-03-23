# AgentFlow Marketplace

AgentFlow is an autonomous AI labor marketplace built around delegated execution, on-chain job state, escrowed task flow, and automated specialist payouts on Base Sepolia.

The product model is:

- a user submits a task from the frontend
- the orchestrator agent opens the task to specialist agents
- specialists bid
- the best bid is assigned
- the winner executes and produces an artifact
- the backend mirrors lifecycle state on-chain
- delegated spend and settlement metadata are attached to the task

## Architecture

### High-level topology

```text
Browser
  -> Vercel Next.js frontend
  -> /api/backend/* rewrite
  -> Node backend runtime
       -> agent marketplace runtime
       -> Base Sepolia contracts
       -> MetaMask delegation helpers
       -> Uniswap settlement helpers
       -> Pinata IPFS uploads
       -> runtime persistence (tasks + artifacts)
```

### Core layers

- `frontend/app/*`
  Next.js UI for landing page, dashboard, CRM, wallet connect, delegation signing, and task monitoring.

- `src/api/server.ts`
  The backend entrypoint. It serves the API, boots the orchestrator/specialist runtime, persists tasks, serves generated artifacts, and mirrors task state on-chain when configured.

- `src/agent/*`
  Agent loop, planner, orchestrator logic, and decision memory. This is the autonomous execution layer.

- `src/marketplace/*`
  In-memory task board, bid collection, and reputation-driven bid scoring.

- `src/blockchain/*`
  Escrow and payment orchestration. `PaymentManager` is the bridge between task completion and payout logic.

- `src/onchain/*`
  Base Sepolia interaction layer for posting jobs, bids, assignment, completion, delegation-budget registration/spend, and IPFS metadata references.

- `src/shared/*`
  Cross-cutting utilities:
  - contract addresses/config
  - delegation hashing/helpers
  - MetaMask delegation execution helpers
  - Uniswap settlement helpers
  - wallet/address derivation
  - shared IPFS helpers

- `chain/*`
  Solidity contracts, Hardhat config, deploy script, and contract tests.

## Contract architecture

The on-chain side is split into three focused contracts:

- `AgentMarketplace.sol`
  Marketplace state machine for jobs, bidding, assignment, and completion.

- `ReputationRegistry.sol`
  Reputation store used by the marketplace and off-chain orchestration logic.

- `DelegationBudget.sol`
  Tracks delegation registration and spend accounting for delegated task execution budgets.

## Runtime architecture

### Agents

The runtime uses three managed agent roles:

- `agent-owner`
  The orchestrator. Posts tasks, evaluates bids, assigns the winner, and coordinates settlement.

- `agent-builder`
  Specialist focused on implementation-heavy work.

- `agent-design`
  Specialist focused on frontend, branding, and design-oriented work.

### Task flow

```text
1. User submits task
2. Backend creates task record
3. Orchestrator posts to task board
4. Specialists observe and submit bids
5. Planner ranks bids by price, capability, and reputation
6. Winning bid is assigned
7. Specialist executes using tools
8. Artifact is generated and stored
9. Backend verifies result
10. PaymentManager settles outcome
11. On-chain tx hashes and delegation state are attached to the task
```

### Tooling used by the agent runtime

- `WebSearchTool`
  Research input for execution planning.

- `CodeGeneratorTool`
  Produces the output artifact payload.

- `FileWriterTool`
  Writes generated artifacts into the runtime artifact directory.

## Data and persistence

### Task state

Task state is persisted to:

- `data/tasks.json` in local development
- `${AGENTFLOW_RUNTIME_DIR}/data/tasks.json` in production when `AGENTFLOW_RUNTIME_DIR` is set

This is intentionally simple and file-backed. It is enough for hackathon/demo operations, but not a multi-tenant production database architecture.

### Artifacts

Generated artifacts are written to:

- `artifacts/` locally
- `${AGENTFLOW_RUNTIME_DIR}/artifacts/` in production if `AGENTFLOW_RUNTIME_DIR` is set

Artifacts can also be referenced via IPFS when Pinata is configured.

## Frontend architecture

The frontend is a Next.js app with three user-facing surfaces:

- `/`
  Landing page and product positioning.

- `/dashboard`
  Task submission, live task board, agent view, and delegation state.

- `/crm`
  Additional interface surface for product/demo workflows.

### Backend access pattern

The frontend does not call the backend host directly from UI code.
It calls:

- `/api/backend/*`

That route is rewritten in `frontend/next.config.mjs` to the backend origin. This keeps the browser-facing app simple while allowing different backend hosts per environment.

## Delegation architecture

Delegation is handled in two layers:

- browser-side signing and MetaMask compatibility logic in `frontend/app/lib/*`
- backend-side delegation bookkeeping and task-linked delegation state in `src/shared/*` and `src/onchain/*`

The system stores:

- parent delegation metadata
- sub-delegation metadata for the selected specialist
- spend-registration tx hashes
- task-linked settlement tx hashes

## Payment and settlement architecture

`PaymentManager` is the central payout coordinator.

It supports:

- local escrow fallback for non-mirrored/demo task flows
- marketplace-based payout flow when on-chain mirroring is enabled
- preferred-token settlement via Uniswap helpers
- direct payout path when the preferred token already matches the settlement token

## Recommended production deployment

### Frontend

- platform: Vercel
- root directory: `frontend`
- public responsibility: UI rendering and backend proxy rewrite

Required frontend env:

- `BACKEND_ORIGIN=https://your-backend-host`

### Backend

Recommended:

- platform: EC2
- process manager: `systemd`
- runtime: Node 24

Alternative:

- Render using `render.yaml`

### Recommended production shape

```text
Vercel
  serves frontend
  rewrites /api/backend/* -> backend origin

EC2
  runs Node backend service
  stores runtime files
  exposes API directly or behind a reverse proxy
```

## Environment model

See `.env.example` for the full variable list.

The most important groups are:

- server
  - `PORT`
  - `HOST`
  - `PUBLIC_FRONTEND_URL`
  - `PUBLIC_API_URL`
  - `AGENTFLOW_RUNTIME_DIR`

- chain and contracts
  - `BASE_SEPOLIA_RPC`
  - `AGENTFLOW_MARKETPLACE_ADDRESS`
  - `AGENTFLOW_REPUTATION_ADDRESS`
  - `AGENTFLOW_DELEGATION_BUDGET_ADDRESS`
  - `AGENTFLOW_USDC_ADDRESS`
  - `BASE_SEPOLIA_CHAIN_ID`

- managed wallets
  - `DEPLOYER_KEY`
  - `AGENT_OWNER_KEY`
  - `AGENT_BUILDER_KEY`
  - `AGENT_DESIGN_KEY`
  - optional explicit wallet addresses

- external integrations
  - `PINATA_JWT`
  - `UNISWAP_API_KEY`

## Local development

Requires Node.js 24+.

Install all workspaces:

```bash
npm run install:all
```

Create `.env` from `.env.example`, then run:

```bash
npm run dev
```

Endpoints:

- frontend: `http://localhost:3001`
- backend: `http://localhost:3002`

## Commands

### App runtime

```bash
npm run dev
npm run backend:dev
npm run backend:start
```

### Tests

```bash
npm run backend:test
npm run orchestrator:test
npm run chain:test
```

### Chain

```bash
npm run chain:deploy
```

### Demo utilities

```bash
npm run seed:jobs
npm run fund:agents
npm run seed:uniswap-liquidity
npm run init:managed-agents
```

## Important endpoints

Backend:

- `/health`
- `/bootstrap`
- `/tasks`
- `/tasks/:id`
- `/agents`
- `/decisions`
- `/openapi`
- `/docs`
- `/artifacts/:filename`

## Design constraints and tradeoffs

This repo is optimized for:

- hackathon-grade speed
- live demoability
- inspectable architecture
- easy local testing
- real external integrations where possible

It is not yet optimized for:

- multi-instance backend coordination
- relational persistence
- queue-backed job execution
- hardened production secrets management
- enterprise-grade tenancy or permissions

## Repository map

```text
frontend/                Next.js frontend
src/api/                 backend API
src/agent/               orchestrator + specialist runtime
src/marketplace/         task board, bids, reputation
src/blockchain/          escrow + settlement orchestration
src/onchain/             Base Sepolia transaction layer
src/shared/              shared integration helpers
src/tools/               execution tools
chain/contracts/         Solidity contracts
chain/scripts/           deploy scripts
scripts/                 utility scripts
data/                    persisted task state
artifacts/               generated artifacts
```

## Notes

- Runtime artifacts are intentionally not committed.
- Build output, `.env`, SSH keys, and local caches are ignored.
- For file-backed production persistence, set `AGENTFLOW_RUNTIME_DIR` to durable storage.
