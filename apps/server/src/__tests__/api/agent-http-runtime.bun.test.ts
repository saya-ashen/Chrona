import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema, type ExecutionEvent } from "@chrona/contracts/steward";
import { agentFixture } from "../../../../../scripts/agent-integration/agent-application.fixtures";
import { startLocalProvider } from "../../../../../packages/engine/src/modules/steward/local-runtime";
import { createServerApp } from "../../app";
import { createStewardRuntime } from "../../steward-runtime";

// Generic server/Agent acceptance uses the real SDK host and a local fake Pi process.
async function fixture() {
  const f = await agentFixture();
  // Reuse only the Agent launcher; discard the engine fixture's unrelated placeholder rows.
  await f.ports.db.module.deleteMany({ where: { name: { in: ["web", "mcp", "files", "notify", "events"] } } });
  const runtime = createStewardRuntime(f.ports.db, { dataDir: f.ports.dataDir, provider: null, sandbox: f.ports.sandbox });
  runtime.ports.agentApplication = f.ports.agentApplication;
  runtime.ports.moduleBuiltinResources = f.ports.moduleBuiltinResources;
  runtime.ports.moduleSdk = f.ports.moduleSdk;
  const db = f.ports.db;
  const entry = await db.module.create({ data: { workspaceId: f.workspaceId, name: "execution-test-entry", activeHash: "v1" } });
  await db.moduleVersion.create({ data: { moduleId: entry.id, hash: "v1", source: "user", status: "approved", intent: {}, report: {},
    manifest: moduleManifestSchema.parse({ name: entry.name, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, uses: ["modules.list"] }) } });
  const session = await db.session.create({ data: { workspaceId: f.workspaceId, source: "module", moduleId: entry.id, key: "fake-pi-http" } });
  await db.audit.create({ data: { id: `agent-context:${session.id}`, workspaceId: f.workspaceId, actorKey: entry.id, kind: "agent_context", subjectId: session.id, details: { hash: "v1" } } });
  await db.run.update({ where: { id: f.input.runId }, data: { sessionId: session.id } });
  await db.audit.create({ data: { id: `agent-tools:${f.input.runId}`, workspaceId: f.workspaceId, actorKey: entry.id, kind: "agent_tools", subjectId: f.input.runId, details: { targets: ["modules.list"] } } });
  const app = await createServerApp({ steward: runtime });
  const headers = { authorization: `Bearer ${f.input.token}`, "content-type": "application/json" };
  const peer = { server: { requestIP: () => ({ address: "127.0.0.1" }) } };
  const request = (path: string, init?: RequestInit) => app.request(`/api/steward-agent${path}`, init, peer);
  return { ...f, runtime, db, headers, request, async close() { await runtime.stop(); await f.close(); } };
}
async function waitForPid(cwd: string) {
  for (let i = 0; i < 100; i++) {
    try { return Number(await readFile(join(cwd, "pi.pid"), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await Bun.sleep(20); }
  }
  throw new Error("Fake Pi did not start");
}

test("generic server authenticates the real Agent capability while actual SDK/fake Pi callbacks and abort stay private", async () => {
  const f = await fixture();
  let handle: Awaited<ReturnType<typeof startLocalProvider>> | undefined;
  try {
    expect((await f.request("/catalog")).status).toBe(401);
    expect((await f.request("/catalog", { headers: { authorization: "Bearer wrong-token" } })).status).toBe(401);
    expect((await f.request("/catalog", { headers: { ...f.headers, "x-forwarded-for": "127.0.0.1" } })).status).toBe(403);
    const catalog = await f.request("/catalog", { headers: f.headers });
    expect(catalog.status).toBe(200);
    expect((await catalog.json()).tools.map((tool: { name: string }) => tool.name)).toEqual(["m_modules_list"]);
    const list = await f.request("/tools/m_modules_list", { method: "POST", headers: f.headers, body: "{}" });
    expect(list.status).toBe(200); expect(await list.json()).toMatchObject({ ok: true });
    const privateTool = await f.request("/tools/m_agent_start", { method: "POST", headers: f.headers, body: "{}" });
    expect(privateTool.status).toBe(409); expect(await privateTool.json()).toMatchObject({ error: { code: "forbidden" } });
    const details: ExecutionEvent[] = [], progress: unknown[] = [];
    const execution = { workId: "generic-pi", sessionId: "generic-session", runId: f.input.runId, attemptId: "generic-attempt" };
    handle = await startLocalProvider(f.runtime.ports, f.workspaceId, { ...f.input, execution,
      detail: { async append(value) { details.push(value); } },
      events: { async progress(value) { progress.push(value); }, async usage() {}, async resources() {}, async question() { return { decision: "cancel" }; } },
    });
    expect(await waitForPid(f.input.cwd)).toBeGreaterThan(0);
    // Detail and progress are delivered through independent callback queues.
    for (let i = 0; i < 100; i++) {
      if (details.some(event => event.payload.type === "tool_started") && progress.some(value => {
        const update = value as { phase: string; tool: string | null };
        return update.phase === "reading" && update.tool === "read";
      })) break;
      await Bun.sleep(20);
    }
    expect(progress).toContainEqual({ phase: "reading", tool: "read" });
    expect(details).toContainEqual(expect.objectContaining({ ...execution, payload: { type: "tool_started", toolCallId: "fixture", tool: "read", display: {} } }));
    await handle.abort();
    const outcome = await handle.done; handle = undefined;
    expect(outcome).toMatchObject({ outcome: "failed" });
    expect(details).toContainEqual(expect.objectContaining({ payload: { type: "state", status: "failed", cancelRequested: false, stopConfirmed: true } }));
    const callbacks = await f.db.moduleInvocation.findMany({ where: { target: "runtime-callback", tool: "event" } });
    expect(callbacks.length).toBeGreaterThan(0);
    expect(callbacks.every(row => row.callerModuleId === f.module.id && row.status === "succeeded")).toBe(true);
    expect(JSON.stringify(await f.db.moduleInvocation.findMany())).not.toContain("private-agent");
    await f.db.run.update({ where: { id: f.input.runId }, data: { status: "finished" } });
    expect((await f.request("/catalog", { headers: f.headers })).status).toBe(401);
  } finally { if (handle) { await handle.abort().catch(() => {}); await handle.done.catch(() => {}); } await f.close(); }
}, 20_000);

test.skipIf(process.platform !== "linux")("losing the actual Agent SDK host stops fake Pi without inventing a successful completion", async () => {
  const f = await fixture();
  try {
    const handle = await startLocalProvider(f.runtime.ports, f.workspaceId, f.input);
    const done = handle.done.then(outcome => ({ outcome, error: null }), error => ({ outcome: null, error }));
    const pid = await waitForPid(f.input.cwd);
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const parentPid = Number(status.match(/^PPid:\s+(\d+)/m)?.[1]);
    expect(parentPid).toBeGreaterThan(0);
    process.kill(-parentPid, "SIGKILL");
    const result = await done;
    expect(result.outcome).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    for (let i = 0; i < 100; i++) {
      try { if ((await readFile(`/proc/${pid}/stat`, "utf8")).split(") ")[1]?.startsWith("Z")) break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; }
      await Bun.sleep(20);
    }
    let alive = false;
    try { alive = !(await readFile(`/proc/${pid}/stat`, "utf8")).split(") ")[1]?.startsWith("Z"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    expect(alive).toBe(false);
    await f.db.run.update({ where: { id: f.input.runId }, data: { status: "finished" } });
    expect((await f.request("/catalog", { headers: f.headers })).status).toBe(401);
  } finally { await f.close(); }
}, 20_000);
