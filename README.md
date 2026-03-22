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
- Task state is stored in `data/tasks.json`; the repo keeps this file clean by default.
- `.env`, SSH keys, build output, and local tool caches are intentionally excluded from version control.
