import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, it, before, after } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const HOST = "127.0.0.1";
const PORT = 3102;
const BASE_URL = `http://${HOST}:${PORT}`;
const ROOT = "/home/hash/my-aproject";

let serverProc: ChildProcessWithoutNullStreams | undefined;

async function waitForHealthy(timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      // keep polling until server is up
    }
    await delay(150);
  }
  throw new Error("server did not become healthy in time");
}

async function waitForTaskTerminal(taskId: string, timeoutMs = 25_000): Promise<{ status: string; seen: string[] }> {
  const terminal = new Set(["completed", "failed", "cancelled"]);
  const seen = new Set<string>();
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${BASE_URL}/tasks/${taskId}`);
    if (res.ok) {
      const payload = (await res.json()) as { status?: string };
      if (payload.status) {
        seen.add(payload.status);
        if (terminal.has(payload.status)) {
          return { status: payload.status, seen: [...seen] };
        }
      }
    }
    await delay(200);
  }

  throw new Error(`task ${taskId} did not reach terminal state in time`);
}

describe("API Integration", () => {
  before(async () => {
    serverProc = spawn(
      "node",
      ["--experimental-strip-types", "src/api/server.ts", "serve"],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          PORT: String(PORT),
          HOST,
          DEV_MODE: "true",
          BIDDING_WINDOW_MS: "1000",
          BID_LATENCY_BUILDER_MS: "400",
          BID_LATENCY_DESIGN_MS: "700",
          BID_LATENCY_DEFAULT_MS: "500"
        }
      }
    );

    await waitForHealthy();
  });

  after(async () => {
    if (!serverProc || serverProc.killed) return;
    serverProc.kill("SIGTERM");
    await delay(250);
    if (!serverProc.killed) {
      serverProc.kill("SIGKILL");
    }
  });

  it("task creation returns immediately", async () => {
    const started = Date.now();
    const res = await fetch(`${BASE_URL}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "build a landing page for wallet onboarding",
        reward: 5
      })
    });
    const elapsedMs = Date.now() - started;

    assert.equal(res.status, 202);
    const payload = (await res.json()) as { accepted?: boolean; taskId?: string; status?: string };
    assert.equal(payload.accepted, true);
    assert.ok(payload.taskId);
    assert.ok(payload.status === "open" || payload.status === "queued");
    assert.ok(elapsedMs < 2000, `POST /tasks should not block; elapsed=${elapsedMs}ms`);
  });

  it("bidding is asynchronous and reaches deterministic terminal flow", async () => {
    const create = await fetch(`${BASE_URL}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "build a landing page and branding copy",
        reward: 6
      })
    });
    const created = (await create.json()) as { taskId: string };
    assert.ok(created.taskId);

    const final = await waitForTaskTerminal(created.taskId);
    assert.equal(final.status, "completed");
    assert.ok(final.seen.includes("bidding"), `expected bidding state in ${final.seen.join(",")}`);
    assert.ok(final.seen.includes("in_progress"), `expected in_progress state in ${final.seen.join(",")}`);

    const taskRes = await fetch(`${BASE_URL}/tasks/${created.taskId}`);
    const task = (await taskRes.json()) as { selectedAgentId?: string; status?: string };
    assert.ok(task.selectedAgentId);
    assert.equal(task.status, "completed");
  });

  it("backend stays healthy while tasks are running", async () => {
    const create = await fetch(`${BASE_URL}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "create a marketing page with hero section",
        reward: 7
      })
    });
    assert.equal(create.status, 202);

    await delay(1000);
    const health = await fetch(`${BASE_URL}/health`);
    assert.equal(health.status, 200);
  });
});
