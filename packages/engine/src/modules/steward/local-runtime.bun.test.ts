import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm, symlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import type { ProviderAdapter } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { testDb } from "./test-db";
import { runtimeCall, startLocalProvider } from "./local-runtime";
import { callSync, kernelOrigin } from "./module-calls";
import { storeChatFile, readChatFile, runFile, chatContentMount } from "./local-content";

async function fixture(provider?: ProviderAdapter) {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-local-modules-");
  const workspace = await db.workspace.create({ data: { name: "local-modules" } });
  const ports: StewardPorts = { db, dataDir, now: () => new Date(), publicUrl: null, provider };
  return { ports, workspaceId: workspace.id,
    async authorize(id: string, token = "secret") {
      const until = new Date(Date.now() + 60_000);
      await db.run.create({ data: { id, workspaceId: workspace.id, lane: "foreground", trigger: "message", status: "running", provider: "fixture", tokenHash: createHash("sha256").update(token).digest("hex"), cwd: dataDir, prompt: "", deadlineAt: until, leaseUntil: until } });
    }, async close() { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); } };
}

test("local Provider uses JSON operations; waiting does not block injection or cancellation", async () => {
  let resolve!: (value: { outcome: "finished"; sessionId: null; error: null }) => void;
  let seen = "", interrupted = false;
  const provider: ProviderAdapter = { name: "fixture", health: async () => ({ available: true, sandboxed: false, error: null }), start() {
    const done = new Promise<{ outcome: "finished"; sessionId: null; error: null }>(finish => { resolve = finish; });
    return { done, async inject(text) { seen = text; }, async abort() { interrupted = true; resolve({ outcome: "finished", sessionId: null, error: null }); } };
  } };
  const f = await fixture(provider);
  try {
    await f.authorize("run", "private-run-capability");
    const handle = await startLocalProvider(f.ports, f.workspaceId, { runId: "run", token: "private-run-capability", lane: "foreground", cwd: f.ports.dataDir, sessionDir: f.ports.dataDir, sessionId: null, prompt: "private prompt", systemPrompt: "boundary", resources: "minimal", deadline: new Date(Date.now() + 10_000) });
    await handle.inject("private message"); expect(seen).toBe("private message");
    await handle.abort(); expect(interrupted).toBe(true);
    expect(await handle.done).toMatchObject({ outcome: "finished" });
    const records = await f.ports.db.moduleInvocation.findMany({ where: { target: "agent" } });
    expect(records.map(row => row.tool)).toEqual(expect.arrayContaining(["start", "wait", "inject", "abort", "release"]));
    expect(JSON.stringify(records)).not.toContain("private");
    await expect(runtimeCall(f.ports, f.workspaceId, "agent.status", { operationId: "run" })).rejects.toMatchObject({ code: "not_found" });
    await expect(callSync(f.ports, { ...kernelOrigin(f.workspaceId), caller: { kind: "owner", via: null } }, "agent.start", {})).rejects.toMatchObject({ code: "forbidden" });
  } finally { await f.close(); }
});

test("Provider event callbacks are routed, scoped and absent from stored payloads", async () => {
  let resolve!: (value: { outcome: "finished"; sessionId: null; error: null }) => void;
  let ask!: () => Promise<unknown>;
  const f = await fixture({ name: "fixture", health: async () => ({ available: true, sandboxed: false, error: null }), start(input) {
    ask = async () => {
      await input.events!.progress({ phase: "reading", tool: null });
      return input.events!.question({ method: "confirm", title: "private question", message: "", options: [], timeoutMs: 1000 }, new AbortController().signal);
    };
    return { done: new Promise(finish => { resolve = finish; }), async inject() {}, async abort() { resolve({ outcome: "finished", sessionId: null, error: null }); } };
  } });
  let progress = false;
  try {
    await f.authorize("events");
    const handle = await startLocalProvider(f.ports, f.workspaceId, { runId: "events", token: "secret", lane: "foreground", cwd: f.ports.dataDir, sessionDir: f.ports.dataDir, sessionId: null, prompt: "", systemPrompt: "", resources: "minimal", deadline: new Date(Date.now() + 10_000), events: { async progress() { progress = true; }, async usage() {}, async resources() {}, async question() { return { decision: "submit", value: true }; } } });
    expect(await ask()).toEqual({ decision: "submit", value: true }); expect(progress).toBe(true);
    await handle.abort(); await handle.done;
    const rows = await f.ports.db.moduleInvocation.findMany({ where: { target: "runtime-callback" } });
    expect(rows.length).toBe(2); expect(JSON.stringify(rows)).not.toContain("private question");
  } finally { await f.close(); }
});

test("an interrupted question reaches its routed controller even when interruption races delivery", async () => {
  let ask!: (signal: AbortSignal) => Promise<unknown>, finish!: () => void;
  const f = await fixture({ name: "fixture", health: async () => ({ available: true, sandboxed: false, error: null }), start(input) {
    ask = signal => input.events!.question({ method: "confirm", title: "Question", message: "", options: [], timeoutMs: 1000 }, signal);
    return { done: new Promise(resolve => { finish = () => resolve({ outcome: "finished", sessionId: null, error: null }); }), async inject() {}, async abort() { finish(); } };
  } });
  try {
    await f.authorize("interrupted");
    const handle = await startLocalProvider(f.ports, f.workspaceId, { runId: "interrupted", token: "secret", lane: "foreground", cwd: f.ports.dataDir, sessionDir: f.ports.dataDir, sessionId: null, prompt: "", systemPrompt: "", resources: "minimal", deadline: new Date(Date.now() + 10_000), events: {
      async progress() {}, async resources() {}, async usage() {},
      question(_question, signal) { return new Promise(resolve => { if (signal.aborted) resolve({ decision: "cancel" }); else signal.addEventListener("abort", () => resolve({ decision: "cancel" }), { once: true }); }); },
    } });
    const controller = new AbortController(); controller.abort();
    expect(await ask(controller.signal)).toEqual({ decision: "cancel" });
    await handle.abort(); await handle.done;
  } finally { await f.close(); }
});

test("Provider operation replay preserves identity and abort request alone never permits release", async () => {
  let starts = 0, finish!: (value: { outcome: "finished"; sessionId: null; error: null }) => void;
  const f = await fixture({ name: "fixture", health: async () => ({ available: true, sandboxed: false, error: null }), start() {
    starts++;
    return { done: new Promise(resolve => { finish = resolve; }), async inject() {}, async abort() {} };
  } });
  try {
    await f.authorize("run");
    const input = { operationId: "run", runId: "run", token: "secret", lane: "foreground", cwd: f.ports.dataDir, sessionDir: f.ports.dataDir, sessionId: null, prompt: "private prompt", systemPrompt: "", resources: "minimal", deadline: new Date(Date.now() + 10_000).toISOString() };
    await expect(runtimeCall(f.ports, f.workspaceId, "agent.start", { ...input, token: "unclaimed" })).rejects.toMatchObject({ code: "forbidden" });
    expect(starts).toBe(0);
    await Promise.all([runtimeCall(f.ports, f.workspaceId, "agent.start", input), runtimeCall(f.ports, f.workspaceId, "agent.start", input)]);
    expect(starts).toBe(1);
    await expect(runtimeCall(f.ports, f.workspaceId, "agent.start", { ...input, prompt: "changed" })).rejects.toMatchObject({ code: "conflict" });
    const other = await f.ports.db.workspace.create({ data: { name: "other" } });
    await expect(runtimeCall(f.ports, other.id, "agent.status", { operationId: input.operationId })).rejects.toMatchObject({ code: "not_found" });
    await runtimeCall(f.ports, f.workspaceId, "agent.abort", { operationId: input.operationId });
    await expect(runtimeCall(f.ports, f.workspaceId, "agent.release", { operationId: input.operationId })).rejects.toMatchObject({ code: "conflict" });
    finish({ outcome: "finished", sessionId: null, error: null });
    await runtimeCall(f.ports, f.workspaceId, "agent.wait", { operationId: input.operationId });
    await runtimeCall(f.ports, f.workspaceId, "agent.release", { operationId: input.operationId });
    await expect(runtimeCall(f.ports, f.workspaceId, "agent.start", input)).rejects.toMatchObject({ code: "unknown" });
    const recreated: StewardPorts = { ...f.ports };
    await expect(runtimeCall(recreated, f.workspaceId, "agent.start", input)).rejects.toMatchObject({ code: "unknown" });
    expect(starts).toBe(1);
  } finally { await f.close(); }
});

test("unconfirmed Provider failure retains the operation and never exposes adapter error bodies", async () => {
  const f = await fixture({ name: "fixture", health: async () => ({ available: true, sandboxed: false, error: null }), start() {
    return { done: Promise.reject(new Error("private raw adapter payload")), async inject() {}, async abort() {} };
  } });
  try {
    await f.authorize("unknown");
    const handle = await startLocalProvider(f.ports, f.workspaceId, { runId: "unknown", token: "secret", lane: "foreground", cwd: f.ports.dataDir, sessionDir: f.ports.dataDir, sessionId: null, prompt: "", systemPrompt: "", resources: "minimal", deadline: new Date(Date.now() + 10_000) });
    await expect(handle.done).rejects.toMatchObject({ code: "unknown", message: "Provider completion remains unconfirmed" });
    expect(await runtimeCall(f.ports, f.workspaceId, "agent.status", { operationId: "unknown" })).toMatchObject({ failure: true, outcome: null });
    await expect(runtimeCall(f.ports, f.workspaceId, "agent.release", { operationId: "unknown" })).rejects.toMatchObject({ code: "conflict" });
    const records = await f.ports.db.moduleInvocation.findMany();
    expect(records.find(row => row.target === "agent" && row.tool === "wait")).toMatchObject({ status: "unknown", error: "unknown" });
    expect(JSON.stringify(records)).not.toContain("private raw adapter payload");
  } finally { await f.close(); }
});

test("local output contracts reject extra fields and installed applications cannot shadow trusted capabilities", async () => {
  const f = await fixture({ name: "fixture", health: async () => ({ available: true, sandboxed: false, error: null, privatePayload: "must not escape" }), start() { throw new Error("unused"); } });
  try {
    await expect(runtimeCall(f.ports, f.workspaceId, "agent.health", {})).rejects.toMatchObject({ code: "failed", message: "Local capability output contract mismatch" });
    const records = await f.ports.db.moduleInvocation.findMany();
    expect(JSON.stringify(records)).not.toContain("must not escape");
    await f.ports.db.module.create({ data: { workspaceId: f.workspaceId, name: "agent" } });
    await expect(runtimeCall(f.ports, f.workspaceId, "agent.health", {})).rejects.toMatchObject({ code: "conflict" });
  } finally { await f.close(); }
});

test.skipIf(process.platform === "win32")("capturing a named pipe rejects without waiting for a writer", async () => {
  const f = await fixture();
  const path = `${f.ports.dataDir}/pipe`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    expect(Bun.spawnSync(["mkfifo", path]).exitCode).toBe(0);
    const result = runFile(f.ports, f.ports.dataDir, "pipe", f.workspaceId).then(() => "accepted", error => error.code);
    const timeout = new Promise<string>(resolve => { timer = setTimeout(() => resolve("blocked"), 1000); });
    const outcome = await Promise.race([result, timeout]);
    if (outcome === "blocked") {
      const writer = await open(path, constants.O_RDWR | constants.O_NONBLOCK);
      await writer.close();
      await result;
    }
    expect(outcome).toBe("invalid");
  } finally { clearTimeout(timer); await f.close(); }
});

test("attachment bytes traverse the same router and capture rejects escaping paths", async () => {
  const f = await fixture();
  try {
    const mount = await chatContentMount(f.ports, f.workspaceId);
    expect(mount).toMatchObject({ name: "chat", writable: false });
    await writeFile(`${f.ports.dataDir}/private.txt`, "secret outside content");
    await symlink(`${f.ports.dataDir}/private.txt`, `${mount.dir}/escape.txt`);
    expect(await readChatFile(f.ports, "chat/escape.txt", f.workspaceId)).toBeNull();
    const stored = await storeChatFile(f.ports, "../report.txt", Buffer.from("private attachment"), f.workspaceId);
    expect(stored.name).toBe("report.txt");
    expect((await readChatFile(f.ports, stored.ref, f.workspaceId))?.bytes.toString()).toBe("private attachment");
    await expect(runFile(f.ports, f.ports.dataDir, "../outside-file", f.workspaceId)).rejects.toBeDefined();
    expect(await readChatFile(f.ports, "chat/../secret", f.workspaceId)).toBeNull();
    const rows = await f.ports.db.moduleInvocation.findMany({ where: { target: "content-local" } });
    expect(rows.map(row => row.tool)).toEqual(expect.arrayContaining(["put", "read", "capture"]));
    expect(JSON.stringify(rows)).not.toContain(Buffer.from("private attachment").toString("base64"));
  } finally { await f.close(); }
});
