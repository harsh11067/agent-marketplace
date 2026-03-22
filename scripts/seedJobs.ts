import { createIpfsUploaderFromEnv } from "../src/shared/ipfs.ts";

async function main(): Promise<void> {
  const uploader = createIpfsUploaderFromEnv();
  const tasks = [
    { description: "Build a landing page for a wallet app", budget: 5 },
    { description: "Summarize the Uniswap v4 whitepaper in 3 bullet points", budget: 3 },
    { description: "Create a dashboard hero and onboarding copy", budget: 4 }
  ];

  for (const task of tasks) {
    const uploaded = await uploader({
      ...task,
      createdAt: new Date().toISOString(),
      kind: "seed-task"
    });
    console.log(`[seedJobs] ${task.description} -> ${uploaded.uri}`);
  }
}

void main().catch((error) => {
  console.error(`[seedJobs] failed ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
