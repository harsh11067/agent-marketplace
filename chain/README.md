# Chain subproject (Base Sepolia)

This folder contains the minimal on-chain contracts for the AgentFlow flow described in `plan.md`.

## Setup

```bash
cd chain
cp .env.example .env
# fill BASE_SEPOLIA_RPC, DEPLOYER_KEY (and optionally USDC_ADDRESS)
npm install
```

## Deploy

```bash
npm run deploy:baseSepolia
```

The script prints environment variables you should copy into the main app `.env`.

