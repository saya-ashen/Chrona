import { readFile } from "./journal-test-storage";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { moduleManifestSchema, type AgentProviderRegistration } from "@chrona/contracts/steward";
import { createAgentConversations } from "./conversations";
import { agent } from "../system/agent";
import { registerAgentProvider } from "../agent/agent-provider";
import { moduleSupervisor } from "../modules/module-supervisor";
import { testModuleProcess } from "../modules/module-test-process";
import { testDb } from "../test-db";
import { registerSystemModules } from "../system-modules";
import type { StewardPorts } from "../ports";
import "../modules/module-effects";

// Exercise the real durable Run view and Provider transcript path, without launching a model.
test("a confirmed failed Run survives a throwing Provider transcript read without replay or cursor mixing", async () => {
  registerSystemModules();
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp(join(tmpdir(), "chrona-conversation-run-read-"));
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const requests: string[] = [], calls: { name: string; args: Record<string, unknown> }[] = [];
  let transcriptFails = false;
  const transcript = [{ at: "2026-11-09T00:00:01.000Z", kind: "text", text: "retained progress" }];
  const peer = testModuleProcess(async event => {
    if (event.trigger.kind !== "tool") return {};
    requests.push(event.trigger.id);
    if (event.trigger.id === "health") return { result: { name: "read-fixture", supportsRunModel: false, complete: false, available: true, sandboxed: false, error: null } };
    if (event.trigger.id === "transcript") {
      if (transcriptFails) throw Object.assign(new Error("Invalid Provider transcript fixture"), { code: "invalid" });
      return { result: transcript };
    }
    throw new Error(`Unexpected Provider call: ${event.trigger.id}`);
  });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), sandbox: { available: true, isolated: false, startModule: peer.startModule } };
  try {
    const workspaceId = (await db.workspace.create({ data: { name: "conversation Run evidence" } })).id;
    const declaration: AgentProviderRegistration = {
      id: "read-fixture", name: "Read fixture", protocolVersion: 1,
      capabilities: { conversation: true, completion: false, native: false, images: false, interactions: false, resume: false },
      endpoints: { health: "health", start: "start", status: "status", inject: "inject", abort: "abort", release: "release", transcript: "transcript" },
    };
    const backend = await db.module.create({ data: { workspaceId, name: "transcript-provider", status: "active", activeHash: "provider-v1" } });
    const tools = Object.values(declaration.endpoints).map(name => ({ name, description: name, visibility: ["kernel"], parameters: { type: "object", properties: name === "transcript" ? { sessionDir: { type: "string" }, limit: { type: "number" } } : {} }, output: {} }));
    await db.moduleVersion.create({ data: { moduleId: backend.id, hash: backend.activeHash!, status: "approved", source: "user", manifest: moduleManifestSchema.parse({ name: backend.name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], tools }), intent: {}, report: {} } });
    await registerAgentProvider(ports, workspaceId, { kind: "module", module: backend.name, moduleId: backend.id, hash: backend.activeHash! }, declaration);
    const owner = await db.module.create({ data: { workspaceId, name: "web-read-fixture", status: "active", activeHash: "web-v1" } });
    await db.moduleVersion.create({ data: { moduleId: owner.id, hash: owner.activeHash!, status: "approved", source: "user", manifest: moduleManifestSchema.parse({ name: owner.name, entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], uses: ["agent.run", "agent.read"] }), intent: {}, report: {} } });
    const caller = { kind: "module" as const, module: owner.name, moduleId: owner.id, hash: owner.activeHash! };
    const invoke = (name: string, args: Record<string, unknown>, key = name) => {
      calls.push({ name, args });
      return agent.handle({ ports, workspaceId, caller, call: { id: key, key } }, name, args);
    };
    const restart = () => createAgentConversations({ dataDir, source: "web", tools: [], reply: () => {}, call: async (target, args = {}, options = {}) => {
      if (target === "web.settings") return { provider: null };
      if (target === "modules.describe") return { items: [], nextCursor: null };
      if (target.startsWith("agent.")) return invoke(target.slice(6), args, options.key);
      throw new Error(`Unexpected app call: ${target}`);
    } });
    const sent = await restart().send({ text: "check state", requestKey: "original" }), runId = sent.runId!;
    const journal = async () => JSON.parse(await readFile(join(dataDir, "conversations/sessions.sqlite"), "utf8"));
    await db.run.update({ where: { id: runId }, data: { status: "running", stopStatus: "pending" } });
    await db.runEvent.create({ data: { runId, sequence: 323, kind: "progress", payload: { type: "progress", value: { phase: "thinking" } } } });
    await db.runEvent.create({ data: { runId, sequence: 324, kind: "raw", payload: { type: "chrona_raw_gap", reason: "too_large" } } });
    expect(await restart().execution(sent.sessionId)).toMatchObject({ status: "running", active: true, phase: "thinking" });
    const cursor = (await journal()).sessions[0].turns[0].cursor;
    expect(JSON.parse(Buffer.from(cursor, "base64url").toString())).toMatchObject({ kind: "normalized", sequence: 323 });
    await db.run.update({ where: { id: runId }, data: { status: "failed", stopStatus: "confirmed", endedAt: new Date(), error: "Pi raw event stream is incomplete" } });
    transcriptFails = true;
    await expect(invoke("read", { runId, cursor, limit: 100 })).rejects.toMatchObject({ code: "invalid" });
    expect(await restart().execution(sent.sessionId)).toMatchObject({ runId, status: "failed", active: false, canContinue: true, replyPending: true });
    expect(calls.at(-1)).toEqual({ name: "read", args: { runId, view: "native", limit: 1 } });
    expect((await journal()).sessions[0].turns[0]).toMatchObject({ status: "failed", active: false, streamPending: true, phase: "thinking", cursor, transcript });
    // Durable stop uncertainty still takes precedence over the stored failed outcome.
    await db.run.update({ where: { id: runId }, data: { stopStatus: "unknown" } });
    expect(await restart().execution(sent.sessionId)).toMatchObject({ status: "unknown", active: true, canContinue: false });
    await db.run.update({ where: { id: runId }, data: { stopStatus: "confirmed" } });
    await restart().poll();
    // When neither view can be read, preserve the last evidence, even if the DB later changes.
    await db.runEvent.deleteMany({ where: { runId, kind: "raw" } });
    await db.run.update({ where: { id: runId }, data: { status: "finished" } });
    expect(await restart().execution(sent.sessionId)).toMatchObject({ status: "failed", active: false, canContinue: true, replyPending: true });
    transcriptFails = false;
    expect(await restart().execution(sent.sessionId)).toMatchObject({ status: "finished", active: false, canContinue: false, replyPending: false });
    expect(calls.at(-1)).toEqual({ name: "read", args: { runId, cursor, limit: 100 } });
    expect(calls.filter(call => call.name !== "read").map(call => call.name)).toEqual(["run"]);
    expect(await db.run.count()).toBe(1);
    expect(new Set(requests)).toEqual(new Set(["health", "transcript"]));
  } finally {
    await moduleSupervisor(ports).stop();
    await db.$disconnect();
    await rm(dataDir, { recursive: true, force: true });
    await rm(dirname(databases.find(row => row.name === "main")!.file), { recursive: true, force: true });
  }
}, 30_000);
