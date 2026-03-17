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
import type { AgentProfile, Task, TaskView } from "../types.ts";

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
  <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agent Marketplace</title>
  <style>
    :root {
      --bg: #efe7db;
      --panel: #fff9f1;
      --ink: #1f2937;
      --muted: #6b7280;
      --line: #d6c7b3;
      --accent: #a16207;
      --open: #6b7280;
      --assigned: #2563eb;
      --progress: #ea580c;
      --paid: #15803d;
      --chip: #f6efe4;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(161, 98, 7, 0.16), transparent 24%),
        radial-gradient(circle at bottom right, rgba(37, 99, 235, 0.08), transparent 22%),
        linear-gradient(180deg, #f8f4ee 0%, var(--bg) 100%);
    }
    main {
      max-width: 1160px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    h1, h2, h3 { margin: 0 0 12px; }
    p { color: var(--muted); margin: 0; }
    .hero {
      display: flex;
      justify-content: space-between;
      align-items: end;
      gap: 16px;
      margin-bottom: 22px;
    }
    .hero p {
      margin-top: 8px;
      max-width: 720px;
    }
    .grid {
      display: grid;
      gap: 20px;
      grid-template-columns: minmax(320px, 1fr) minmax(360px, 1.1fr);
      align-items: start;
    }
    .panel {
      background: color-mix(in srgb, var(--panel) 94%, white);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 20px;
      box-shadow: 0 18px 42px rgba(31, 41, 55, 0.08);
    }
    .panel-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }
    form { display: grid; gap: 12px; }
    textarea, button {
      font: inherit;
      border-radius: 12px;
      border: 1px solid var(--line);
      padding: 12px 14px;
    }
    textarea {
      min-height: 120px;
      resize: vertical;
      background: #fff;
    }
    button {
      background: var(--accent);
      color: white;
      cursor: pointer;
      border: none;
      transition: transform 120ms ease, opacity 120ms ease;
    }
    button:hover {
      transform: translateY(-1px);
    }
    .ghost {
      background: #fff;
      color: var(--ink);
      border: 1px solid var(--line);
    }
    ul {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 14px;
    }
    .card {
      padding: 14px;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.82);
    }
    .meta {
      font-size: 14px;
      color: var(--muted);
      margin-top: 6px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 999px;
      font-weight: 700;
      text-transform: capitalize;
      font-size: 13px;
      background: var(--chip);
    }
    .status-open { color: var(--open); }
    .status-assigned { color: var(--assigned); }
    .status-in_progress { color: var(--progress); }
    .status-completed { color: var(--progress); }
    .status-paid { color: var(--paid); }
    .agent-list {
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }
    .capabilities {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .capability {
      display: inline-block;
      padding: 5px 9px;
      border-radius: 999px;
      background: var(--chip);
      color: var(--ink);
      font-size: 12px;
      border: 1px solid var(--line);
    }
    .reputation {
      font-weight: 700;
      color: var(--paid);
    }
    .task-top {
      display: flex;
      justify-content: space-between;
      align-items: start;
      gap: 12px;
    }
    .lifecycle {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
      margin-top: 14px;
    }
    .stage {
      text-align: center;
      padding: 10px 8px;
      border-radius: 12px;
      border: 1px solid var(--line);
      color: var(--muted);
      background: #fbf7f1;
      font-size: 12px;
      text-transform: lowercase;
    }
    .stage.active {
      color: white;
      border-color: transparent;
      font-weight: 700;
      box-shadow: inset 0 -8px 18px rgba(255, 255, 255, 0.08);
    }
    .stage-open.active { background: var(--open); }
    .stage-assigned.active { background: var(--assigned); }
    .stage-in_progress.active { background: var(--progress); }
    .stage-completed.active { background: var(--progress); }
    .stage-paid.active { background: var(--paid); }
    .artifact-link {
      color: var(--assigned);
      text-decoration: none;
      font-weight: 700;
    }
    .artifact-link:hover {
      text-decoration: underline;
    }
    .wallet {
      display: inline-flex;
      align-items: center;
      gap: 10px;
    }
    .wallet-status {
      font-size: 13px;
      color: var(--muted);
    }
    @media (max-width: 860px) {
      .hero,
      .panel-head,
      .task-top {
        flex-direction: column;
        align-items: start;
      }
      .grid {
        grid-template-columns: 1fr;
      }
      .lifecycle {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div>
        <h1>Agent Marketplace</h1>
        <p>Track the full task lifecycle, inspect agent reputation, open generated artifacts, and connect a wallet for MetaMask-aware escrow flows.</p>
      </div>
      <div class="wallet">
        <button id="wallet-connect" class="ghost" type="button">Connect MetaMask</button>
        <span id="wallet-status" class="wallet-status">Wallet not connected</span>
      </div>
    </section>
    <div class="grid">
      <section class="panel">
        <div class="panel-head">
          <h2>Submit Task</h2>
          <span class="status-badge status-open">open</span>
        </div>
        <form id="task-form">
          <textarea id="description" name="description" placeholder="Build a landing page for a new product launch"></textarea>
          <button type="submit">Submit</button>
        </form>
        <p id="submit-status"></p>
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2>Agents</h2>
          <span class="meta">Reputation and capabilities</span>
        </div>
        <ul id="agents" class="agent-list"></ul>
      </section>
    </div>
    <section class="panel" style="margin-top:20px;">
      <div class="panel-head">
        <h2>Tasks</h2>
        <span class="meta">Auto refresh every 3 seconds</span>
      </div>
      <ul id="tasks"></ul>
    </section>
  </main>
  <script>
    const lifecycle = ['open', 'assigned', 'in_progress', 'completed', 'paid'];

    function visualStatus(task) {
      return task.status === 'submitted' || task.status === 'verified' ? 'completed' : task.status;
    }

    function stageMarkup(task) {
      const current = visualStatus(task);
      const currentIndex = lifecycle.indexOf(current);
      return lifecycle.map((stage, index) => {
        const active = index <= currentIndex ? 'active stage-' + stage : '';
        const label = stage === 'in_progress' ? 'in progress' : stage;
        return '<div class="stage ' + active + '">' + label + '</div>';
      }).join('');
    }

    function statusBadge(task) {
      const current = visualStatus(task);
      const label = current === 'in_progress' ? 'in progress' : current;
      return '<span class="status-badge status-' + current + '">' + label + '</span>';
    }

    function artifactMarkup(task) {
      if (!task.artifactPath) {
        return 'Not available yet';
      }
      const filename = task.artifactPath.split('/').pop();
      return '<a class="artifact-link" href="/artifacts/' + encodeURIComponent(filename) + '" target="_blank" rel="noreferrer">' + filename + '</a>';
    }

    function capabilityMarkup(capabilities) {
      return capabilities.map((capability) =>
        '<span class="capability">' + capability + '</span>'
      ).join('');
    }

    async function connectWallet() {
      const status = document.getElementById('wallet-status');
      if (!window.ethereum) {
        status.textContent = 'MetaMask not available';
        return;
      }

      try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const account = accounts && accounts[0] ? accounts[0] : '';
        status.textContent = account
          ? account.slice(0, 6) + '...' + account.slice(-4)
          : 'Wallet not connected';
      } catch (error) {
        status.textContent = 'Wallet connection rejected';
      }
    }

    async function refresh() {
      const [tasks, agents] = await Promise.all([
        fetch('/tasks').then((res) => res.json()),
        fetch('/agents').then((res) => res.json())
      ]);

      document.getElementById('tasks').innerHTML = tasks.map((task) => \`
        <li class="card">
          <div class="task-top">
            <strong>\${task.title}</strong>
            \${statusBadge(task)}
          </div>
          <div class="meta">\${task.description}</div>
          <div class="meta">Selected agent: \${task.selectedAgentName || 'Pending'}</div>
          <div class="meta">Artifact: \${artifactMarkup(task)}</div>
          <div class="lifecycle">\${stageMarkup(task)}</div>
        </li>
      \`).join('');

      document.getElementById('agents').innerHTML = agents.map((agent) => \`
        <li class="card">
          <div class="task-top">
            <strong>\${agent.name}</strong>
            <span class="reputation">Rep \${agent.reputation}</span>
          </div>
          <div class="meta">ID: \${agent.id}</div>
          <div class="capabilities">\${capabilityMarkup(agent.capabilities)}</div>
        </li>
      \`).join('');
    }

    document.getElementById('wallet-connect').addEventListener('click', connectWallet);
    document.getElementById('task-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = document.getElementById('submit-status');
      const description = document.getElementById('description').value.trim();
      if (!description) {
        status.textContent = 'Description required.';
        return;
      }
      status.textContent = 'Submitting task...';
      const response = await fetch('/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description })
      });
      const payload = await response.json();
      status.textContent = response.ok ? 'Task completed through marketplace flow.' : (payload.error || 'Submit failed.');
      if (response.ok) {
        document.getElementById('description').value = '';
      }
      await refresh();
    });

    refresh();
    setInterval(refresh, 3000);
  </script>
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
  const paymentManager = new PaymentManager(createEscrowContract(), {
    "agent-owner": process.env.AGENT_OWNER_WALLET ?? "",
    "agent-builder": process.env.AGENT_BUILDER_WALLET ?? "",
    "agent-design": process.env.AGENT_DESIGN_WALLET ?? ""
  });

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
      minPrice: 0
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
      minPrice: 30
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
      minPrice: 40
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
  taskBoard.on("bidSelected", persist);
  taskBoard.on("taskStarted", persist);
  taskBoard.on("resultSubmitted", persist);
  taskBoard.on("taskVerified", persist);
  taskBoard.on("paymentReleased", persist);

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

async function waitForCompletion(check: () => boolean): Promise<void> {
  const start = Date.now();

  while (!check()) {
    if (Date.now() - start > 10000) {
      throw new Error("Timeout waiting for task");
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function startHttpServer(): Promise<void> {
  const runtime = await createRuntime();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";

  const server = createServer(async (req, res) => {
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

    if (req.method === "GET" && req.url === "/tasks") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(toTaskView(runtime.taskBoard, runtime.agents), null, 2));
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

    if (req.method === "POST" && req.url === "/submit") {
      const body = await readJsonBody<{
        title?: string;
        description?: string;
        reward?: number;
        requirements?: string[];
      }>(req);
      const title = body.title?.trim();
      const description = body.description?.trim();
      const reward = typeof body.reward === "number" && Number.isFinite(body.reward)
        ? body.reward
        : undefined;
      const requirements = Array.isArray(body.requirements)
        ? body.requirements.map((item) => item.trim()).filter(Boolean)
        : undefined;

      if (!description) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "description required" }));
        return;
      }

      const task = runtime.coordinator.submitTask(description, {
        title,
        reward,
        requirements
      });
      console.log(`[API] Task created: ${task.id}`);

      await waitForCompletion(() =>
        runtime.taskBoard.getTask(task.id)?.status === "paid"
      );

      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(toTaskView(runtime.taskBoard, runtime.agents).find((item) => item.id === task.id), null, 2));
      return;
    }

    res.statusCode = 404;
    res.end("Not found");
  });

  server.listen(port, host, () => {
    console.log(`Server running → http://${host}:${port} (dashboard: /dashboard)`);
  });
}

async function readJsonBody<T>(req: any): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// ENTRY
const mode = process.argv[2];

if (mode === "serve") {
  void startHttpServer();
}
