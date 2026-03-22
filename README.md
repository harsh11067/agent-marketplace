# AgentFlow Marketplace

AgentFlow is an autonomous AI labor marketplace built around Base Sepolia, delegated execution, on-chain job state, and automated settlement.

## Stack

- Backend agent runtime and API: `src/api/server.ts`
- Marketplace and orchestration logic: `src/agent/*`, `src/marketplace/*`
- On-chain integrations and settlement: `src/onchain/*`, `src/blockchain/*`, `src/shared/*`
- Contracts and deployment: `chain/*`
- Frontend dashboard and landing pages: `frontend/app/*`

## Local Setup

Requires Node.js 24+.

Install all workspaces:

```bash
npm run install:all
```

Create a local environment file from `.env.example` and fill in your Base Sepolia, Uniswap, Pinata, and wallet values.

Run the app:

```bash
npm run dev
```

Endpoints:

- Frontend: `http://localhost:3001`
- Backend: `http://localhost:3002`

## Deploy

### Frontend on Vercel

- Set the Vercel project root directory to `frontend`
- Add env var `BACKEND_ORIGIN=https://your-render-service.onrender.com`
- Deploy as a normal Next.js app

The frontend keeps calling `/api/backend/*` and Next.js rewrites those requests to `BACKEND_ORIGIN`.

### Backend on Render

- Deploy the repo root as a Node web service
- Build command: `npm install`
- Start command: `npm run backend:start`
- Attach a persistent disk and set `AGENTFLOW_RUNTIME_DIR` to a path on that disk, for example `/var/data/agentflow`
- Set `PUBLIC_FRONTEND_URL=https://your-vercel-app.vercel.app`

For the full on-chain flow, also set:

- `BASE_SEPOLIA_RPC`
- `AGENTFLOW_MARKETPLACE_ADDRESS`
- `AGENTFLOW_REPUTATION_ADDRESS`
- `AGENTFLOW_DELEGATION_BUDGET_ADDRESS`
- `AGENTFLOW_USDC_ADDRESS`
- `DEPLOYER_KEY`
- `AGENT_OWNER_KEY`
- `AGENT_BUILDER_KEY`
- `AGENT_DESIGN_KEY`
- `PINATA_JWT`
- `UNISWAP_API_KEY`

If you want the backend docs page to print the exact production API hostname, also set `PUBLIC_API_URL`.

## Useful Commands

```bash
npm run backend:test
npm run orchestrator:test
npm run chain:test
npm run chain:deploy
npm run seed:jobs
npm run fund:agents
npm run seed:uniswap-liquidity
```

## Project Notes

- Runtime artifacts are generated under `artifacts/` and are not committed.
- Task state is stored in `data/tasks.json`; on Render, use `AGENTFLOW_RUNTIME_DIR` on a persistent disk.
- `.env`, SSH keys, build output, and local tool caches are intentionally excluded from version control.
