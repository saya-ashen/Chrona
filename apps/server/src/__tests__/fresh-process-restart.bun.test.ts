import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const dbPath = resolve(`.tmp/chrona-restart-${process.pid}-${Date.now()}.db`);
const databaseUrl = `file:${dbPath}`;
const port = 44_000 + Math.floor(Math.random() * 1_000);
const serverUrl = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof Bun.spawn> | null = null;

async function run(command: string[]) {
  const process = Bun.spawn(command, { cwd: resolve("."), stdout: "pipe", stderr: "pipe" });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed: ${await new Response(process.stderr).text()}`);
  }
}

async function startServer() {
  server = Bun.spawn(["bun", "run", "apps/server/src/index.bun.ts"], {
    cwd: resolve("."),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      CHRONA_TASK_ORCHESTRATOR_ENABLED: "true",
      CHRONA_TASK_ORCHESTRATOR_TICK_ON_START: "true",
      CHRONA_TASK_ORCHESTRATOR_INTERVAL_MS: "600000",
      CHRONA_TASK_ORCHESTRATOR_LEASE_TTL_MS: "100",
      CHRONA_TASK_ORCHESTRATOR_OWNER_ID: `process-${Date.now()}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  for (let attempt = 0; attempt < 250; attempt += 1) {
    try {
      if ((await fetch(`${serverUrl}/health`)).ok) return;
    } catch {
      // Server is still starting.
    }
    await Bun.sleep(20);
  }

  server.kill("SIGTERM");
  await server.exited;
  const stderr = server.stderr instanceof ReadableStream ? await new Response(server.stderr).text() : String(server.stderr ?? "");
  server = null;
  throw new Error(`Server did not become healthy: ${stderr}`);
}

async function stopServer() {
  if (!server) return;
  server.kill("SIGTERM");
  await server.exited;
  server = null;
}

function seedRestartState() {
  const db = new Database(dbPath);
  const now = new Date().toISOString();
  const workspaceId = "restart-workspace";
  const taskId = "restart-task";
  const sessionId = "restart-session";
  const runId = "restart-run";
  db.exec("PRAGMA foreign_keys = ON");
  db.query("INSERT INTO Workspace (id, name, status, defaultRuntime, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
    .run(workspaceId, "Restart workspace", "Active", "debug", now, now);
  db.query("INSERT INTO Task (id, workspaceId, title, status, priority, executionRuntime, executionConfig, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(taskId, workspaceId, "Waiting across restart", "Running", "High", "debug", "{}", now, now);
  db.query("INSERT INTO TaskPlan (id, workspaceId, taskId, planId, revision, status, compiledPlan, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("restart-plan-record", workspaceId, taskId, "restart-plan", 1, "Accepted", "{}", now, now);
  db.query("INSERT INTO TaskPlanRun (id, workspaceId, taskId, planId, planRun, executionOwnerId, executionEpoch, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("restart-plan-run", workspaceId, taskId, "restart-plan", "{}", "dead-process", 1, now, now);
  db.query("INSERT INTO ExecutionSession (id, workspaceId, taskId, planId, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(sessionId, workspaceId, taskId, "restart-plan", "Active", now, now);
  db.query("INSERT INTO Run (id, taskId, runtimeName, runtimeRunRef, status, triggeredBy, syncStatus, retryable, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(runId, taskId, "debug", "debug-waiting-run", "WaitingForInput", "scheduler", "synced", 0, now, now);
  db.close();
}

describe("fresh process restart recovery", () => {
  beforeAll(async () => {
    await run(["bun", "run", "scripts/init-sqlite-db.ts", "--reset", dbPath]);
    seedRestartState();
  });

  afterAll(async () => {
    await stopServer();
    if (existsSync(dbPath)) rmSync(dbPath, { force: true });
  });

  it("preserves waiting work and does not duplicate its run after a real server restart", async () => {
    await startServer();
    await stopServer();
    await startServer();

    const db = new Database(dbPath, { readonly: true });
    const session = db.query<{ status: string; pauseReason: string | null }, []>("SELECT status, pauseReason FROM ExecutionSession WHERE id = 'restart-session'").get();
    const runs = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM Run WHERE taskId = 'restart-task'").get();
    const run = db.query<{ status: string }, []>("SELECT status FROM Run WHERE id = 'restart-run'").get();
    db.close();

    expect(session).toEqual({ status: "Active", pauseReason: null });
    expect(run?.status).toBe("WaitingForInput");
    expect(runs?.count).toBe(1);
  }, 15_000);
});
