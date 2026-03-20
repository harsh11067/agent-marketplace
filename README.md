# Synthesis Agent Marketplace

Minimal Node.js + TypeScript framework for a decentralized-style AI agent marketplace where agents can hire other agents to complete work.

## Architecture

- `src/agent/agentLoop.ts`: event-driven coordinator and worker agent loops
- `src/agent/planner.ts`: requirement inference, bid scoring, result verification
- `src/agent/memory.ts`: in-memory decision log for auditability
- `src/marketplace/taskBoard.ts`: task board and marketplace event bus
- `src/marketplace/biddingEngine.ts`: autonomous bid creation
- `src/marketplace/reputation.ts`: simple reputation scoring
- `src/tools/*`: mock tools for research, code generation, and file output
- `src/blockchain/*`: mocked escrow and payment release logic
- `src/api/server.ts`: HTTP API plus CLI demo entrypoint

## Core Flow

1. A coordinator agent receives a task.
2. The task is posted to the marketplace task board.
3. Worker agents detect the new task and submit bids.
4. The coordinator scores bids using price, reputation, and capability.
5. The best bid is selected automatically.
6. A mock escrow is funded.
7. The winning worker executes the task with tools.
8. The result is submitted and verified.
9. Payment is released and worker reputation increases.

## Run

Requires Node.js 24+.

First, install dependencies for both the backend engine and the React user interface:

```bash
# This installs packages across the entire workspace
npm run install:all
```

Start the unified server (this spins up both backend API on :3002 and Next.js frontend on :3001 concurrently):

```bash
npm run dev
```

Then open your browser to **http://localhost:3001/**

### Testing with CLI (Optional)

You can still submit a custom task directly to the backend bypassing the UI:

```bash
node --experimental-strip-types src/api/server.ts submit "build a landing page for a wallet app"
```

Or via cURL to the API:

```bash
curl -X POST http://localhost:3002/tasks \
  -H "content-type: application/json" \
  -d '{"description":"build a landing page"}'
```

## Example Task Flow

Input:

```text
build a landing page
```

Expected behavior:

- Owner Agent posts the task
- Builder Agent and Design Agent bid
- The planner picks the strongest bid
- A mock escrow is created
- The worker writes an HTML artifact under `artifacts/`
- The coordinator verifies the artifact and releases payment

## Example Agent Configuration

```ts
{
  id: "agent-builder",
  name: "Builder Agent",
  role: "worker",
  budget: 0,
  capabilities: ["frontend", "copywriting", "generalist"],
  minPrice: 30
}
```

## Notes

- This is intentionally minimal and uses in-memory state only.
- The blockchain layer is mocked but preserves the escrow lifecycle.
- The tool system is modular, so real LLM, wallet, and on-chain integrations can replace the mocks.
