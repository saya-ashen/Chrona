import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { callSync, kernelOrigin, enqueueCall } from "./module-calls";
import { runtimeCall, startLocalProvider } from "./local-runtime";
import { createAgentOperations } from "./builtin/agent/operations";
import "./module-effects";

import { agentFixture as fixture } from "./agent-application.fixtures";

test("real builtin Agent SDK process: controls stay responsive, callback identities and sensitive logs stay bounded", async () => {
  const f = await fixture();
  try {
    expect(await runtimeCall(f.ports, f.workspaceId, "agent.health", {})).toMatchObject({ name: "pi", available: true });
    for (const caller of [{ kind: "owner" as const, via: null }, { kind: "provider" as const, runId: "agent-run" }]) await expect(callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller }, "agent.start", { input: "{}" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(enqueueCall({ tx: f.ports.db, ports: f.ports, origin: kernelOrigin(f.workspaceId), target: "agent.start", raw: { input: "private" } }, { key: "no-persist" })).rejects.toMatchObject({ code: "invalid" });
    let progress = false;
    const handle = await startLocalProvider(f.ports, f.workspaceId, { ...f.input, events: { async progress() { progress = true; }, async usage() {}, async resources() {}, async question() { return { decision: "cancel" }; } } });
    for (let i = 0; i < 100 && !progress; i++) await Bun.sleep(20);
    expect(progress).toBe(true);
    expect(await readFile(join(f.input.cwd, "started"), "utf8")).toBe("yes");
    await handle.abort();
    expect(await handle.done).toMatchObject({ outcome: "failed" });
    const invocations = await f.ports.db.moduleInvocation.findMany({ where: { target: { in: ["agent", "runtime-callback"] } } });
    expect(JSON.stringify(invocations)).not.toContain("private-agent");
    const runs = await f.ports.db.moduleRun.findMany({ where: { moduleId: f.module.id } });
    expect(runs.length).toBeGreaterThan(0); expect(JSON.stringify(runs)).not.toContain("private-agent");
    expect(invocations.some(row => row.target === "runtime-callback" && row.callerModuleId === f.module.id)).toBe(true);
    await expect(callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: { kind: "module", module: "other", moduleId: f.module.id, hash: "different" } }, "runtime-callback.event", { callbackId: crypto.randomUUID(), event: { kind: "progress", value: { phase: "reading", tool: null } } })).rejects.toMatchObject({ code: "forbidden" });
  } finally { await f.close(); }
}, 20000);

test.skipIf(process.platform !== "linux")("losing the builtin Agent process stops its process group without inventing a completion", async () => {
  const f = await fixture();
  try {
    const handle = await startLocalProvider(f.ports, f.workspaceId, f.input);
    const done = handle.done.then(outcome => ({ outcome, error: null }), error => ({ outcome: null, error }));
    let pid: number | undefined;
    for (let i = 0; i < 100 && !pid; i++) {
      try { pid = Number(await readFile(join(f.input.cwd, "pi.pid"), "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await Bun.sleep(20); }
    }
    expect(pid).toBeGreaterThan(0);
    const processStatus = await readFile(`/proc/${pid}/status`, "utf8");
    const parentPid = Number(processStatus.match(/^PPid:\s+(\d+)/m)?.[1]);
    expect(parentPid).toBeGreaterThan(0);
    process.kill(-parentPid, "SIGKILL");
    const result = await done;
    expect(result.outcome).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    try { expect(await readFile(`/proc/${pid}/status`, "utf8")).toMatch(/^State:\s+Z/m); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  } finally { await f.close(); }
}, 20000);

test("Agent journal preserves uncertain starts across restart without launching again", async () => {
  const root = await mkdtemp("/tmp/chrona-agent-journal-"); let starts = 0;
  const provider = { name: "fixture", async health() { return { available: true, sandboxed: false, error: null }; }, start() { starts++; return { done: new Promise<never>(() => {}), async inject() {}, async abort() {} }; } };
  const input = { operationId: "run", runId: "run", token: "private-token", lane: "foreground", cwd: root, sessionDir: root, sessionId: null, prompt: "private-prompt", systemPrompt: "", resources: "minimal", deadline: new Date(Date.now() + 1000).toISOString() };
  try {
    await createAgentOperations(provider, root, value => value as never).start(input);
    const restarted = createAgentOperations(provider, root, value => value as never);
    expect(await restarted.control("status", { operationId: "run" })).toMatchObject({ failure: true, outcome: null });
    await expect(restarted.start(input)).rejects.toMatchObject({ code: "unknown" });
    await expect(restarted.control("release", { operationId: "run" })).rejects.toMatchObject({ code: "conflict" });
    expect(starts).toBe(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
