import { createServer } from "node:http";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { AgentLoop } from "../agent/agentLoop.ts";
import { AgentMemory } from "../agent/memory.ts";
import { Planner } from "../agent/planner.ts";
import { createEscrowContract } from "../blockchain/escrowContract.ts";
import { PaymentManager } from "../blockchain/paymentManager.ts";
import { BiddingEngine } from "../marketplace/biddingEngine.ts";
import { ReputationStore } from "../marketplace/reputation.ts";
import { TaskBoard } from "../marketplace/taskBoard.ts";
import { CodeGeneratorTool } from "../tools/codeGenerator.ts";
import { FileWriterTool } from "../tools/fileWriter.ts";
import { WebSearchTool } from "../tools/webSearch.ts";
import type { AgentProfile, MetaMaskPermissionRecord, Task, TaskView } from "../types.ts";
import {
  approveUsdcIfNeeded,
  assignJobOnchain,
  completeJobOnchain,
  deriveManagedAddresses,
  isOnchainEnabled,
  loadOnchainConfigFromEnv,
  postJobOnchain,
  recordDelegationSpendOnchain,
  registerDelegationOnchain,
  submitBidOnchain
} from "../onchain/agentflowMarketplace.ts";
import { createIpfsUploaderFromEnv, type IpfsJsonUploader } from "../shared/ipfs.ts";
import { delegatedApproveUsdc, delegatedAssignJob, delegatedPostJob } from "../shared/metamaskDelegation.ts";
import { createSignedSubDelegation } from "../shared/metamaskToolkitDelegation.ts";
import { isUniswapConfigured } from "../shared/uniswap.ts";
import { loadChainIdFromEnv, resolveManagedWallet } from "../shared/wallet.ts";
import type { DelegationRecord, SubDelegationRecord } from "../types.ts";
import { createDelegationDigest, createDelegationNonce } from "../shared/delegation.ts";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = resolve(workspaceRoot, "data");
const tasksFile = resolve(dataDir, "tasks.json");
const artifactsDir = resolve(workspaceRoot, "artifacts");

async function loadPersistedTasks(taskBoard: TaskBoard): Promise<void> {
  try {
    await access(tasksFile);
    const raw = await readFile(tasksFile, "utf8");
    const tasks = JSON.parse(raw) as Task[];
    taskBoard.importTasks(tasks);
    console.log(`[persist:load] tasks=${tasks.length} file=${tasksFile}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[persist:load] skipped file=${tasksFile} reason=${message}`);
  }
}

async function saveTasks(taskBoard: TaskBoard): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(tasksFile, JSON.stringify(taskBoard.listTasks(), null, 2), "utf8");
  console.log(`[persist:save] tasks=${taskBoard.listTasks().length} file=${tasksFile}`);
}

function toAgentView(agents: { profile: AgentProfile }[], reputation: ReputationStore) {
  return agents.map(({ profile }) => ({
    id: profile.id,
    name: profile.name,
    capabilities: profile.capabilities,
    reputation: reputation.get(profile.id)
  }));
}

function toTaskView(taskBoard: TaskBoard, agents: { profile: AgentProfile }[]): TaskView[] {
  const agentNames = new Map(agents.map(({ profile }) => [profile.id, profile.name]));

  return taskBoard.listTasks().map((task) => {
    const winningBid = task.selectedBidId
      ? taskBoard.getBids(task.id).find((bid) => bid.id === task.selectedBidId)
      : undefined;
    const bidPrefix = `bid-${task.id}-`;
    const selectedAgentId = winningBid?.agentId
      ?? task.selectedAgentId
      ?? (task.selectedBidId?.startsWith(bidPrefix) ? task.selectedBidId.slice(bidPrefix.length) : undefined);

    return {
      ...task,
      selectedAgentName: selectedAgentId ? agentNames.get(selectedAgentId) : undefined,
      artifactPath: task.result?.artifactPath
    };
  });
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="0; url=http://localhost:3001/" />
  <title>Agent Marketplace</title>
</head>
<body>
  <p>Redirecting to <a href="http://localhost:3001/">Frontend AgentFlow Dashboard...</a></p>
</body>
</html>`;
}

function setCorsHeaders(res: any): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

function redirect(res: any, location: string): void {
  res.statusCode = 308;
  res.setHeader("location", location);
  res.end();
}

function getContentType(filename: string): string {
  switch (extname(filename).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

async function serveArtifact(req: any, res: any): Promise<boolean> {
  const url = req.url ?? "";
  if (req.method !== "GET" || !url.startsWith("/artifacts/")) {
    return false;
  }

  const filename = decodeURIComponent(url.slice("/artifacts/".length));
  if (!filename || filename.includes("/") || filename.includes("\\")) {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "invalid artifact filename" }));
    return true;
  }

  const artifactPath = resolve(artifactsDir, filename);
  if (!artifactPath.startsWith(`${artifactsDir}${sep}`)) {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "invalid artifact path" }));
    return true;
  }

  try {
    const content = await readFile(artifactPath);
    res.setHeader("content-type", getContentType(filename));
    res.end(content);
  } catch {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "artifact not found" }));
  }

  return true;
}

async function createRuntime() {
  const taskBoard = new TaskBoard();
  const planner = new Planner();
  const memory = new AgentMemory();
  const reputation = new ReputationStore();
  const biddingEngine = new BiddingEngine(reputation);
  const onchainConfig = loadOnchainConfigFromEnv();
  const derivedAddresses = deriveManagedAddresses(onchainConfig);
  const walletByAgentId: Record<string, string> = {
    "agent-owner": resolveManagedWallet({
      explicitAddress: process.env.AGENT_OWNER_WALLET,
      privateKey: onchainConfig.orchestratorKey
    }) || derivedAddresses.orchestratorAddress,
    "agent-builder": resolveManagedWallet({
      explicitAddress: process.env.AGENT_BUILDER_WALLET,
      privateKey: onchainConfig.builderKey
    }) || derivedAddresses.builderAddress,
    "agent-design": resolveManagedWallet({
      explicitAddress: process.env.AGENT_DESIGN_WALLET,
      privateKey: onchainConfig.designKey
    }) || derivedAddresses.designAddress
  };
  const keyByAgentId: Record<string, string> = {
    "agent-owner": onchainConfig.orchestratorKey ?? "",
    "agent-builder": onchainConfig.builderKey ?? "",
    "agent-design": onchainConfig.designKey ?? ""
  };
  const paymentManager = new PaymentManager(createEscrowContract(), walletByAgentId, keyByAgentId);
  let ipfsUploader: IpfsJsonUploader | undefined;
  try {
    ipfsUploader = createIpfsUploaderFromEnv();
  } catch {
    ipfsUploader = undefined;
  }

  const tools = {
    webSearch: new WebSearchTool(),
    codeGenerator: new CodeGeneratorTool(),
    fileWriter: new FileWriterTool()
  };

  reputation.set("agent-builder", 72);
  reputation.set("agent-design", 88);

  await loadPersistedTasks(taskBoard);

  const coordinator = new AgentLoop(
    {
      id: "agent-owner",
      name: "Owner Agent",
      role: "coordinator",
      budget: 250,
      capabilities: ["planning", "verification"],
      minPrice: 0,
      walletAddress: walletByAgentId["agent-owner"],
      preferredTokenAddress: onchainConfig.usdcAddress,
      preferredTokenSymbol: "USDC"
    },
    taskBoard,
    planner,
    memory,
    biddingEngine,
    paymentManager,
    reputation,
    tools,
    workspaceRoot
  );

  const builder = new AgentLoop(
    {
      id: "agent-builder",
      name: "Builder Agent",
      role: "worker",
      budget: 0,
      capabilities: ["frontend", "copywriting", "generalist"],
      minPrice: 30,
      walletAddress: walletByAgentId["agent-builder"],
      preferredTokenAddress: process.env.AGENT_BUILDER_PREFERRED_TOKEN ?? onchainConfig.usdcAddress,
      preferredTokenSymbol: process.env.AGENT_BUILDER_PREFERRED_SYMBOL ?? "ETH"
    },
    taskBoard,
    planner,
    memory,
    biddingEngine,
    paymentManager,
    reputation,
    tools,
    workspaceRoot
  );

  const designer = new AgentLoop(
    {
      id: "agent-design",
      name: "Design Agent",
      role: "worker",
      budget: 0,
      capabilities: ["frontend", "branding", "copywriting"],
      minPrice: 40,
      walletAddress: walletByAgentId["agent-design"],
      preferredTokenAddress: process.env.AGENT_DESIGN_PREFERRED_TOKEN ?? onchainConfig.usdcAddress,
      preferredTokenSymbol: process.env.AGENT_DESIGN_PREFERRED_SYMBOL ?? "USDC"
    },
    taskBoard,
    planner,
    memory,
    biddingEngine,
    paymentManager,
    reputation,
    tools,
    workspaceRoot
  );

  [coordinator, builder, designer].forEach((agent) => agent.start());

  const persist = () => {
    void saveTasks(taskBoard);
  };

  taskBoard.on("taskPosted", persist);
  taskBoard.on("bidSubmitted", persist);
  taskBoard.on("bidSelected", persist);
  taskBoard.on("taskStarted", persist);
  taskBoard.on("resultSubmitted", persist);
  taskBoard.on("taskCompleted", persist);
  taskBoard.on("taskFailed", persist);
  taskBoard.on("taskCancelled", persist);

  // On-chain glue (minimal): mirror off-chain lifecycle into Base Sepolia if configured.
  // This keeps the existing architecture intact and only augments tasks with chain metadata.
  if (isOnchainEnabled(onchainConfig)) {
    const delegationBudgetAddress = onchainConfig.delegationBudgetAddress ?? "";
    taskBoard.on("taskPosted", (task: Task) => {
      void (async () => {
        try {
          const orchestratorKey = onchainConfig.orchestratorKey ?? "";
          if (!orchestratorKey) {
            throw new Error("missing AGENT_OWNER_KEY");
          }

          const deadlineUnix = typeof task.deadline === "number" && Number.isFinite(task.deadline)
            ? task.deadline
            : Math.floor(Date.now() / 1000) + 3600;

          const budgetUsdc6 = BigInt(Math.max(1, Math.floor((task.reward ?? 1) * 1_000_000)));
          const delegatedContext = task.metamaskPermission?.context;
          const delegatedManager = task.metamaskPermission?.signerMeta?.delegationManager;
          let taskURI = `local://${task.id}`;
          if (ipfsUploader) {
            const uploadedTask = await ipfsUploader({
              kind: "agentflow-task",
              taskId: task.id,
              title: task.title,
              description: task.description,
              reward: task.reward,
              requirements: task.requirements,
              createdAt: task.createdAt ?? Date.now(),
              delegation: task.delegation ?? null
            });
            taskURI = uploadedTask.uri;
          }

          const approval = delegatedContext && delegatedManager
            ? await delegatedApproveUsdc({
                rpcUrl: onchainConfig.rpcUrl,
                orchestratorKey,
                permissionsContext: delegatedContext as `0x${string}`,
                delegationManager: delegatedManager as `0x${string}`,
                usdcAddress: onchainConfig.usdcAddress as `0x${string}`,
                spender: onchainConfig.marketplaceAddress as `0x${string}`,
                amount: budgetUsdc6
              }).then((result) => ({ approved: true, txHash: result.txHash, allowance: budgetUsdc6 }))
            : await approveUsdcIfNeeded({
                rpcUrl: onchainConfig.rpcUrl,
                usdcAddress: onchainConfig.usdcAddress,
                spender: onchainConfig.marketplaceAddress,
                ownerKey: orchestratorKey,
                minAmount: budgetUsdc6
              });

          const posted = delegatedContext && delegatedManager
            ? await delegatedPostJob({
                rpcUrl: onchainConfig.rpcUrl,
                orchestratorKey,
                permissionsContext: delegatedContext as `0x${string}`,
                delegationManager: delegatedManager as `0x${string}`,
                marketplaceAddress: onchainConfig.marketplaceAddress as `0x${string}`,
                taskURI,
                budgetUsdc6,
                deadlineUnix
              })
            : await postJobOnchain({
                rpcUrl: onchainConfig.rpcUrl,
                marketplaceAddress: onchainConfig.marketplaceAddress,
                orchestratorKey,
                taskURI,
                budgetUsdc6,
                deadlineUnix
              });

          const live = taskBoard.getTask(task.id);
          if (live) {
            live.chainJobId = posted.jobId || live.chainJobId;
            live.txHashes = {
              ...(live.txHashes ?? {}),
              ...(approval.txHash ? { usdcApprove: approval.txHash } : {}),
              jobPosted: posted.txHash
            };
            live.deadline = deadlineUnix;
            if (delegationBudgetAddress && live.delegation) {
              const delegationHash = live.delegation.digest ?? createDelegationDigest({
                chainId: live.delegation.chainId,
                delegator: live.delegation.delegator,
                delegate: live.delegation.delegate,
                token: live.delegation.token,
                capAmount: live.delegation.capAmount,
                deadline: live.delegation.deadline,
                nonce: live.delegation.nonce
              });
              live.delegation.digest = delegationHash;
              live.txHashes = {
                ...(live.txHashes ?? {}),
                delegationDigest: delegationHash
              };
              persist();

              const registered = await registerDelegationOnchain({
                rpcUrl: onchainConfig.rpcUrl,
                delegationBudgetAddress,
                actorKey: orchestratorKey,
                delegationHash,
                delegator: live.delegation.delegator,
                delegate: live.delegation.delegate,
                cap: BigInt(live.delegation.capAmount),
                deadlineUnix: live.delegation.deadline
              });
              live.txHashes = {
                ...(live.txHashes ?? {}),
                delegationRegistered: registered.txHash
              };
              persist();

              const spent = await recordDelegationSpendOnchain({
                rpcUrl: onchainConfig.rpcUrl,
                delegationBudgetAddress,
                delegateKey: orchestratorKey,
                delegationHash,
                amount: budgetUsdc6
              });
              live.txHashes = {
                ...(live.txHashes ?? {}),
                delegationSpend: spent.txHash
              };
            }
          }
          persist();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`[onchain:taskPosted] skipped task=${task.id} reason=${message}`);
        }
      })();
    });

    taskBoard.on("bidSubmitted", (bid: any) => {
      void (async () => {
        try {
          const task = taskBoard.getTask(bid.taskId);
          if (!task?.chainJobId) {
            return;
          }

          const agentKey = bid.agentId === "agent-builder"
            ? (onchainConfig.builderKey ?? "")
            : bid.agentId === "agent-design"
              ? (onchainConfig.designKey ?? "")
              : "";
          if (!agentKey) {
            throw new Error(`missing agent key for ${bid.agentId}`);
          }

          const priceUsdc6 = BigInt(Math.max(1, Math.floor(bid.price * 1_000_000)));
          let metadataURI = `local://bid/${bid.id}`;
          if (ipfsUploader) {
            const uploadedBid = await ipfsUploader({
              kind: "agentflow-bid",
              bidId: bid.id,
              taskId: bid.taskId,
              agentId: bid.agentId,
              price: bid.price,
              rationale: bid.rationale,
              createdAt: bid.createdAt
            });
            metadataURI = uploadedBid.uri;
          }
          const submitted = await submitBidOnchain({
            rpcUrl: onchainConfig.rpcUrl,
            marketplaceAddress: onchainConfig.marketplaceAddress,
            agentKey,
            jobId: task.chainJobId,
            priceUsdc6,
            metadataURI
          });

          task.txHashes = {
            ...(task.txHashes ?? {}),
            [`bid:${bid.agentId}`]: submitted.txHash
          };
          persist();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`[onchain:bidSubmitted] skipped bid=${bid.id} reason=${message}`);
        }
      })();
    });

    taskBoard.on("bidSelected", (task: Task, bid: any) => {
      void (async () => {
        try {
          if (!task.chainJobId) {
            return;
          }
          const orchestratorKey = onchainConfig.orchestratorKey ?? "";
          if (!orchestratorKey) {
            throw new Error("missing AGENT_OWNER_KEY");
          }
          const winnerAddress = walletByAgentId[bid.agentId];
          if (!winnerAddress) {
            throw new Error(`missing wallet address for ${bid.agentId}`);
          }
          const agreedPriceUsdc6 = BigInt(Math.max(1, Math.floor(bid.price * 1_000_000)));
          const delegatedContext = task.metamaskPermission?.context;
          const delegatedManager = task.metamaskPermission?.signerMeta?.delegationManager;
          const assigned = delegatedContext && delegatedManager
            ? await delegatedAssignJob({
                rpcUrl: onchainConfig.rpcUrl,
                orchestratorKey,
                permissionsContext: delegatedContext as `0x${string}`,
                delegationManager: delegatedManager as `0x${string}`,
                marketplaceAddress: onchainConfig.marketplaceAddress as `0x${string}`,
                jobId: task.chainJobId,
                winnerAddress: winnerAddress as `0x${string}`,
                agreedPriceUsdc6
              })
            : await assignJobOnchain({
                rpcUrl: onchainConfig.rpcUrl,
                marketplaceAddress: onchainConfig.marketplaceAddress,
                orchestratorKey,
                jobId: task.chainJobId,
                winnerAddress,
                agreedPriceUsdc6
              });
          task.txHashes = {
            ...(task.txHashes ?? {}),
            jobAssigned: assigned.txHash
          };
          // Minimal sub-delegation record (User → Orchestrator → Specialist). The cryptographic
          // delegation execution is handled by MetaMask tooling; here we persist linkage for the UI/demo.
          const parentDelegation = task.delegation;
          const subDelegation = await createSignedSubDelegation({
            chainId: loadChainIdFromEnv(),
            orchestratorKey,
            parentDelegation: parentDelegation ?? {
              kind: "erc7715-delegation",
              chainId: loadChainIdFromEnv(),
              delegator: task.delegator ?? winnerAddress,
              delegate: task.delegate ?? winnerAddress,
              token: onchainConfig.usdcAddress,
              capAmount: String(Math.max(1, Math.floor((task.reward ?? 1) * 1_000_000))),
              nonce: createDelegationNonce(`${task.id}:parent`),
              deadline: task.deadline ?? Math.floor(Date.now() / 1000) + 3600
            },
            specialistAddress: winnerAddress,
            tokenAddress: onchainConfig.usdcAddress,
            capAmount: String(Math.max(1, Math.floor(bid.price * 1_000_000))),
            deadlineUnix: task.deadline ?? Math.floor(Date.now() / 1000) + 3600,
            saltSeed: `${task.id}:${bid.agentId}`
          }) ?? {
            kind: "erc7715-delegation",
            chainId: loadChainIdFromEnv(),
            delegator: task.delegate ?? task.delegator ?? winnerAddress,
            delegate: winnerAddress,
            token: onchainConfig.usdcAddress,
            capAmount: String(Math.max(1, Math.floor(bid.price * 1_000_000))),
            nonce: createDelegationNonce(`${task.id}:${bid.agentId}`),
            deadline: task.deadline ?? Math.floor(Date.now() / 1000) + 3600,
            parentDigest: parentDelegation?.digest,
            createdAt: Date.now()
          } satisfies SubDelegationRecord;
          if (delegationBudgetAddress) {
            const subDelegationHash = createDelegationDigest({
              chainId: subDelegation.chainId,
              delegator: subDelegation.delegator,
              delegate: subDelegation.delegate,
              token: subDelegation.token,
              capAmount: subDelegation.capAmount,
              deadline: subDelegation.deadline,
              nonce: subDelegation.nonce
            });
            subDelegation.digest = subDelegationHash;
            const registered = await registerDelegationOnchain({
              rpcUrl: onchainConfig.rpcUrl,
              delegationBudgetAddress,
              actorKey: orchestratorKey,
              delegationHash: subDelegationHash,
              delegator: subDelegation.delegator,
              delegate: subDelegation.delegate,
              cap: BigInt(subDelegation.capAmount),
              deadlineUnix: subDelegation.deadline
            });
            task.txHashes = {
              ...(task.txHashes ?? {}),
              subDelegationDigest: subDelegationHash,
              subDelegationRegistered: registered.txHash
            };
          }
          task.subDelegation = subDelegation;
          persist();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`[onchain:bidSelected] skipped task=${task.id} reason=${message}`);
        }
      })();
    });

    taskBoard.on("resultSubmitted", (task: Task, result: any) => {
      void (async () => {
        try {
          if (!task.chainJobId) {
            return;
          }
          const agentId = task.selectedAgentId;
          if (!agentId) {
            return;
          }
          const agentKey = agentId === "agent-builder"
            ? (onchainConfig.builderKey ?? "")
            : agentId === "agent-design"
              ? (onchainConfig.designKey ?? "")
              : "";
          if (!agentKey) {
            throw new Error(`missing agent key for ${agentId}`);
          }

          let resultURI = result?.artifactPath ? `local://${result.artifactPath}` : `local://result/${task.id}`;
          if (ipfsUploader) {
            const uploadedResult = await ipfsUploader({
              kind: "agentflow-result",
              taskId: task.id,
              summary: result?.summary ?? "",
              artifactPath: result?.artifactPath ?? "",
              verificationNotes: result?.verificationNotes ?? ""
            });
            resultURI = uploadedResult.uri;
          }

          const completed = await completeJobOnchain({
            rpcUrl: onchainConfig.rpcUrl,
            marketplaceAddress: onchainConfig.marketplaceAddress,
            agentKey,
            jobId: task.chainJobId,
            resultURI
          });

          task.txHashes = {
            ...(task.txHashes ?? {}),
            jobCompleted: completed.txHash
          };
          persist();
          if (delegationBudgetAddress && task.subDelegation?.digest) {
            const winningBid = task.selectedBidId
              ? taskBoard.getBids(task.id).find((item) => item.id === task.selectedBidId)
              : undefined;
            const amountUsdc6 = BigInt(
              Math.max(1, Math.floor((winningBid?.price ?? task.reward ?? 1) * 1_000_000))
            );
            const spent = await recordDelegationSpendOnchain({
              rpcUrl: onchainConfig.rpcUrl,
              delegationBudgetAddress,
              delegateKey: agentKey,
              delegationHash: task.subDelegation.digest,
              amount: amountUsdc6
            });
            task.txHashes = {
              ...(task.txHashes ?? {}),
              subDelegationSpend: spent.txHash
            };
          }
          persist();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`[onchain:resultSubmitted] skipped task=${task.id} reason=${message}`);
        }
      })();
    });
  }

  return {
    agents: [coordinator, builder, designer],
    coordinator,
    taskBoard,
    memory,
    reputation,
    stop() {
      for (const agent of this.agents) {
        agent.stop();
      }
    }
  };
}

async function startHttpServer(): Promise<void> {
  const runtime = await createRuntime();
  const port = Number(process.env.PORT ?? 3002);
  const host = process.env.HOST ?? "0.0.0.0";

  const server = createServer(async (req, res) => {
    try {
      setCorsHeaders(res);

      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.url === "/taskss") {
        redirect(res, "/tasks");
        return;
      }

      if (req.url === "/agentss") {
        redirect(res, "/agents");
        return;
      }

      if (await serveArtifact(req, res)) {
        return;
      }

      if (req.method === "GET" && req.url === "/") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(dashboardHtml());
        return;
      }

      if (req.method === "GET" && req.url === "/dashboard") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(dashboardHtml());
        return;
      }

      if (req.method === "GET" && req.url === "/health") {
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true, uptimeSec: Math.floor(process.uptime()) }));
        return;
      }

      if (req.method === "GET" && (req.url === "/openapi" || req.url === "/openapi.json")) {
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify(openApiSpec, null, 2));
        return;
      }

      if (req.method === "GET" && req.url === "/docs") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(docsHtml());
        return;
      }

      if (req.method === "GET" && req.url === "/bootstrap") {
        const bootstrapOnchain = loadOnchainConfigFromEnv();
        const bootstrapManaged = deriveManagedAddresses(bootstrapOnchain);
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(
        JSON.stringify(
          {
            orchestratorAddress: process.env.AGENT_OWNER_WALLET ?? bootstrapManaged.orchestratorAddress
            ,
            chainId: loadChainIdFromEnv(),
            usdcAddress: process.env.AGENTFLOW_USDC_ADDRESS ?? "",
            delegationBudgetAddress: process.env.AGENTFLOW_DELEGATION_BUDGET_ADDRESS ?? "",
            uniswapEnabled: isUniswapConfigured()
          },
          null,
          2
        )
        );
        return;
      }

      if (req.method === "GET" && req.url === "/tasks") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(toTaskView(runtime.taskBoard, runtime.agents), null, 2));
        return;
      }

      if (req.method === "GET" && req.url?.startsWith("/tasks/")) {
      const taskId = decodeURIComponent(req.url.slice("/tasks/".length));
      const match = toTaskView(runtime.taskBoard, runtime.agents).find((item) => item.id === taskId);
      if (!match) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "task not found" }));
        return;
      }
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(match, null, 2));
        return;
      }

      if (req.method === "GET" && req.url === "/agents") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(toAgentView(runtime.agents, runtime.reputation), null, 2));
        return;
      }

      if (req.method === "GET" && req.url === "/decisions") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(runtime.memory.list(), null, 2));
        return;
      }

      if (req.method === "POST" && (req.url === "/submit" || req.url === "/tasks")) {
      let body: {
        title?: unknown;
        description?: unknown;
        reward?: unknown;
        deadline?: unknown;
        delegator?: unknown;
        delegate?: unknown;
        delegation?: DelegationRecord;
        subDelegation?: unknown;
        metamaskPermission?: MetaMaskPermissionRecord;
        paymentTxHash?: unknown;
        requirements?: unknown;
      };

      try {
        body = await readJsonBody(req);
      } catch (error) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "invalid json body" }));
        return;
      }

      const title = typeof body.title === "string" ? body.title.trim() : undefined;
      const description = typeof body.description === "string" ? body.description.trim() : undefined;
      const reward = typeof body.reward === "number" && Number.isFinite(body.reward) ? body.reward : undefined;
      const deadline = typeof body.deadline === "number" && Number.isFinite(body.deadline) ? body.deadline : undefined;
      const delegator = typeof body.delegator === "string" ? body.delegator : undefined;
      const delegate = typeof body.delegate === "string" ? body.delegate : undefined;
      const delegation = body.delegation;
      const subDelegation = body.subDelegation as SubDelegationRecord | undefined;
      const metamaskPermission = body.metamaskPermission as MetaMaskPermissionRecord | undefined;
      const requirements = Array.isArray(body.requirements)
        ? body.requirements
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined;

      if (!description) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "description required" }));
        return;
      }

      const paymentTxHash = typeof body.paymentTxHash === "string" ? body.paymentTxHash : undefined;

        const task = runtime.coordinator.submitTask(description, {
        title,
        reward,
        requirements,
        deadline,
        delegator,
        delegate,
        delegation,
        subDelegation,
        metamaskPermission
      });
        if (paymentTxHash) {
          task.txHashes = { ...(task.txHashes ?? {}), paymentTx: paymentTxHash };
        }
        console.log(`[API] Task created: ${task.id} status=${task.status}`);

        res.statusCode = 202;
        res.setHeader("content-type", "application/json");
        res.end(
        JSON.stringify(
          {
            accepted: true,
            taskId: task.id,
            status: task.status,
            task: toTaskView(runtime.taskBoard, runtime.agents).find((item) => item.id === task.id)
          },
          null,
          2
        )
        );
        return;
      }

      res.statusCode = 404;
      res.end("Not found");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[server:request-error] ${req.method ?? "?"} ${req.url ?? "?"} ${message}`);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "internal server error", details: message }));
      } else {
        res.end();
      }
    }
  });

  server.on("error", (error: any) => {
    const code = error && typeof error === "object" ? (error as any).code : undefined;
    const message = error instanceof Error ? error.message : String(error);
    if (code === "EADDRINUSE") {
      console.error(`[server:error] port ${port} is already in use. Stop the existing process or set PORT.`);
    } else {
      console.error(`[server:error] ${code ?? "unknown"} ${message}`);
    }
    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    console.log(`Server running → http://${host}:${port} (dashboard: /dashboard)`);
  });
}

const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Agent Marketplace API",
    version: "1.0.0",
    description:
      "Minimal HTTP API for submitting tasks into an agent marketplace and inspecting task/agent state."
  },
  servers: [
    {
      url: "/",
      description: "Current server"
    }
  ],
  paths: {
    "/tasks": {
      get: {
        summary: "List tasks",
        responses: {
          "200": {
            description: "Array of tasks",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/TaskView" }
                }
              }
            }
          }
        }
      },
      post: {
        summary: "Submit a task",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TaskCreateRequest" }
            }
          }
        },
        responses: {
          "202": {
            description: "Accepted task (returns immediately)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    accepted: { type: "boolean" },
                    taskId: { type: "string" },
                    status: { type: "string" },
                    task: { $ref: "#/components/schemas/TaskView" }
                  }
                }
              }
            }
          },
          "400": {
            description: "Invalid request body",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" }
              }
            }
          }
        }
      }
    },
    "/tasks/{taskId}": {
      get: {
        summary: "Get task by id",
        parameters: [
          {
            name: "taskId",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          "200": {
            description: "Task view",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskView" }
              }
            }
          },
          "404": {
            description: "Not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" }
              }
            }
          }
        }
      }
    },
    "/agents": {
      get: {
        summary: "List agents",
        responses: {
          "200": {
            description: "Array of agents",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/AgentView" }
                }
              }
            }
          }
        }
      }
    },
    "/decisions": {
      get: {
        summary: "List agent decisions log",
        responses: {
          "200": {
            description: "Array of decisions",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/AgentDecision" }
                }
              }
            }
          }
        }
      }
    },
    "/openapi": {
      get: {
        summary: "OpenAPI spec",
        responses: {
          "200": {
            description: "OpenAPI 3.1 JSON"
          }
        }
      }
    },
    "/bootstrap": {
      get: {
        summary: "Bootstrap config for dashboard",
        responses: {
          "200": {
            description: "Bootstrap payload",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    orchestratorAddress: { type: "string" },
                    chainId: { type: "number" },
                    usdcAddress: { type: "string" },
                    delegationBudgetAddress: { type: "string" },
                    uniswapEnabled: { type: "boolean" }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  components: {
    schemas: {
      ErrorResponse: {
        type: "object",
        properties: {
          error: { type: "string" }
        }
      },
      TaskCreateRequest: {
        type: "object",
        required: ["description"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          reward: { type: "number" },
          deadline: { type: "number", description: "Unix timestamp (seconds)" },
          delegator: { type: "string" },
          delegate: { type: "string" },
          delegation: { type: "object", additionalProperties: true },
          subDelegation: { type: "object", additionalProperties: true },
          metamaskPermission: { type: "object", additionalProperties: true },
          paymentTxHash: { type: "string" },
          requirements: { type: "array", items: { type: "string" } }
        }
      },
      TaskResult: {
        type: "object",
        required: ["summary", "artifactPath", "verificationNotes"],
        properties: {
          summary: { type: "string" },
          artifactPath: { type: "string" },
          verificationNotes: { type: "string" }
        }
      },
      TaskView: {
        type: "object",
        required: ["id", "title", "description", "reward", "requirements", "createdBy", "status"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          reward: { type: "number" },
          requirements: { type: "array", items: { type: "string" } },
          createdBy: { type: "string" },
          status: { type: "string" },
          delegator: { type: "string" },
          delegate: { type: "string" },
          deadline: { type: "number" },
          delegation: { type: "object", additionalProperties: true },
          subDelegation: { type: "object", additionalProperties: true },
          metamaskPermission: { type: "object", additionalProperties: true },
          chainJobId: { type: "number" },
          txHashes: {
            type: "object",
            additionalProperties: { type: "string" }
          },
          settlement: {
            type: "object",
            additionalProperties: true
          },
          selectedBidId: { type: "string" },
          selectedAgentId: { type: "string" },
          selectedBidPrice: { type: "number" },
          selectedAgentName: { type: "string" },
          escrowId: { type: "string" },
          txHash: { type: "string" },
          result: { $ref: "#/components/schemas/TaskResult" },
          artifactPath: { type: "string" }
        }
      },
      AgentView: {
        type: "object",
        required: ["id", "name", "capabilities", "reputation"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          capabilities: { type: "array", items: { type: "string" } },
          reputation: { type: "number" }
        }
      },
      AgentDecision: {
        type: "object",
        required: ["agentId", "type", "message", "timestamp"],
        properties: {
          agentId: { type: "string" },
          type: { type: "string" },
          message: { type: "string" },
          timestamp: { type: "number" },
          metadata: { type: "object" }
        }
      }
    }
  }
} as const;

function docsHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agent Marketplace Docs</title>
  <style>
    :root { --bg:#0b1020; --panel:#111a33; --ink:#e5e7eb; --muted:#9ca3af; --accent:#f59e0b; --line:#223055; }
    * { box-sizing: border-box; }
    body { margin:0; background:radial-gradient(circle at top, rgba(245,158,11,.15), transparent 40%), var(--bg); color:var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 18px 56px; }
    h1 { margin: 0 0 10px; letter-spacing: -0.02em; }
    p { margin: 0 0 14px; color: var(--muted); line-height: 1.5; }
    .panel { background: rgba(17,26,51,.92); border: 1px solid var(--line); border-radius: 18px; padding: 18px; margin-top: 16px; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    pre { background: rgba(0,0,0,.25); border: 1px solid rgba(255,255,255,.06); border-radius: 14px; padding: 14px; overflow:auto; }
    a { color: var(--accent); text-decoration: none; font-weight: 700; }
    a:hover { text-decoration: underline; }
    .warn { border-color: rgba(239,68,68,.45); background: rgba(239,68,68,.08); }
    .warn strong { color: rgba(239,68,68,.95); }
  </style>
</head>
<body>
  <main>
    <h1>Agent Marketplace — API Docs</h1>
    <p>Minimal docs inspired by SugarClawdy’s “docs + OpenAPI” pattern: a human page plus a machine-readable spec.</p>

    <div class="panel">
      <p><strong>OpenAPI JSON:</strong> <a href="/openapi" target="_blank" rel="noreferrer">/openapi</a></p>
      <p><strong>Dashboard:</strong> <a href="/dashboard">/dashboard</a></p>
      <p><strong>Bootstrap:</strong> <a href="/bootstrap" target="_blank" rel="noreferrer">/bootstrap</a></p>
    </div>

    <div class="panel warn">
      <p><strong>Security note:</strong> never commit or log private keys/mnemonics. Only wallet addresses are safe to share.</p>
    </div>

    <div class="panel">
      <p><strong>Delegation flow</strong> (User → Orchestrator → Specialist): the dashboard signs an EIP-712 delegation payload in MetaMask and sends it to the backend with the task. The backend stores it under the task record.</p>
      <p><strong>On-chain mirroring</strong>: if you set the Base Sepolia + contract env vars, the backend will mirror lifecycle events on-chain and store TxIDs on the task under <code>txHashes</code>.</p>

      <pre><code># required for on-chain mirroring
BASE_SEPOLIA_RPC=...
AGENTFLOW_USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
AGENTFLOW_MARKETPLACE_ADDRESS=0x...
AGENTFLOW_REPUTATION_ADDRESS=0x...

# keys for local demo only (never commit real keys)
AGENT_OWNER_KEY=0x...
AGENT_BUILDER_KEY=0x...
AGENT_DESIGN_KEY=0x...</code></pre>

      <p><strong>Submit a task</strong> (returns immediately, processing is async):</p>
      <pre><code>curl -X POST http://localhost:3002/tasks \\
  -H "content-type: application/json" \\
  -d '{"description":"build a landing page","reward":5,"deadline":1730000000}'</code></pre>
      <p><strong>List tasks</strong>:</p>
      <pre><code>curl http://localhost:3002/tasks</code></pre>
      <p><strong>Get one task</strong>:</p>
      <pre><code>curl http://localhost:3002/tasks/task-123</code></pre>
      <p><strong>List agents</strong>:</p>
      <pre><code>curl http://localhost:3002/agents</code></pre>
    </div>
  </main>
</body>
</html>`;
}

async function readJsonBody(req: any): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

// ENTRY
const mode = process.argv[2];

process.on("unhandledRejection", (reason) => {
  console.error(`[process:unhandledRejection] ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
});

process.on("uncaughtException", (error) => {
  console.error(`[process:uncaughtException] ${error.stack ?? error.message}`);
});

if (mode === "serve") {
  void startHttpServer();
}

async function waitForTerminalState(check: () => string | undefined): Promise<void> {
  const start = Date.now();
  while (true) {
    const status = check();
    if (status && ["completed", "failed", "cancelled"].includes(status)) {
      return;
    }
    if (Date.now() - start > 60_000) {
      throw new Error("Timeout waiting for terminal state");
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function runSubmitCli(description: string): Promise<void> {
  const runtime = await createRuntime();
  try {
    const task = runtime.coordinator.submitTask(description);
    await waitForTerminalState(() => runtime.taskBoard.getTask(task.id)?.status);
    const view = toTaskView(runtime.taskBoard, runtime.agents).find((item) => item.id === task.id);
    console.log(JSON.stringify(view, null, 2));
  } finally {
    runtime.stop();
  }
}

async function runDemoCli(): Promise<void> {
  const runtime = await createRuntime();
  try {
    const samples = [
      "build a landing page for a wallet app",
      "draft a short product launch announcement and hero copy",
      "create a minimal portfolio HTML page"
    ];
    for (const description of samples) {
      const task = runtime.coordinator.submitTask(description);
      await waitForTerminalState(() => runtime.taskBoard.getTask(task.id)?.status);
      const view = toTaskView(runtime.taskBoard, runtime.agents).find((item) => item.id === task.id);
      console.log(`[demo] completed task=${task.id} title="${task.title}" artifact=${view?.artifactPath ?? "n/a"}`);
    }
  } finally {
    runtime.stop();
  }
}

if (mode === "submit") {
  const description = process.argv.slice(3).join(" ").trim();
  if (!description) {
    console.error('Usage: node src/api/server.ts submit "task description"');
    process.exitCode = 1;
  } else {
    void runSubmitCli(description);
  }
}

if (mode === "demo") {
  void runDemoCli();
}
