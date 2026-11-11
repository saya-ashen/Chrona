import { afterEach, expect, test } from "bun:test";
import { testDb } from "./test-db";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { registerSystemModules } from "./system-modules";
import { callSync, kernelOrigin, listLocalModules, moduleCallbackContractHash } from "./module-calls";
import { moduleTools } from "./module-tools";
import { registerProviderCallbacks, retainProviderCallbacks } from "./local-provider";
import { selectedMemory } from "./entry-app/memory";
import memoryManifest from "./external/memory-local/module.json";
import { createApprovals } from "./approvals";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function fixture() {
  const db = testDb({ injectedAgent: false }); cleanups.push(() => db.$disconnect());
  const workspaceId = (await db.workspace.create({ data: { name: "minimization-boundaries" } })).id;
  const ports: StewardPorts = { db, dataDir: "/unused", now: () => new Date("2026-11-08T12:00:00Z"), publicUrl: null };
  async function app(name: string, extra: Record<string, unknown> = {}) {
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [], ...extra });
    const row = await db.module.create({ data: { workspaceId, name, activeHash: "approved" } });
    await db.moduleVersion.create({ data: { moduleId: row.id, hash: "approved", status: "approved", manifest, intent: {}, source: "", report: {} } });
    return { kind: "module" as const, module: name, moduleId: row.id, hash: "approved" };
  }
  return { db, workspaceId, ports, app };
}
test("actual private runtime host is absent from public tools and rejects ordinary callback or admission callers", async () => {
  registerSystemModules(); registerProviderCallbacks();
  const f = await fixture(), ordinary = await f.app("ordinary", { uses: ["*"],
      authority: "owner"
});
  const host = listLocalModules().find(module => module.name === "runtime-callback");
  expect(host?.tools.map(tool => tool.name).sort()).toEqual(["agent-admit", "agent-settle", "event"]);
  for (const audience of ["owner", "provider", "modules"] as const) {
    expect((await moduleTools(f.ports, { workspaceId: f.workspaceId, audience })).some(tool => tool.module.name === "runtime-callback")).toBe(false);
  }
  for (const caller of [ordinary, { kind: "owner" as const, via: null }, { kind: "provider" as const, runId: "run" }]) {
    const reply = await callSync(f.ports, { workspaceId: f.workspaceId, caller, chain: [], path: [] }, "modules.describe", {});
    expect((reply.output as { items: { target: unknown }[] }).items.some(tool => typeof tool.target === "string" && tool.target.startsWith("runtime-callback."))).toBe(false);
  }
  const origin = { workspaceId: f.workspaceId, caller: ordinary, chain: [], path: [] };
  await expect(callSync(f.ports, origin, "runtime-callback.agent-admit", { callId: "forged", operation: "run" })).rejects.toMatchObject({ code: "forbidden" });
  await expect(callSync(f.ports, origin, "runtime-callback.agent-settle", { reservationId: "forged", failed: true })).rejects.toMatchObject({ code: "forbidden" });
  let delivered = 0;
  const callback = retainProviderCallbacks(f.ports, f.workspaceId, { events: { progress: async () => { delivered++; }, usage: async () => {}, resources: async () => {}, question: async () => ({ decision: "cancel" }) } });
  const args = { callbackId: callback.id, event: { kind: "progress", value: { phase: "thinking", tool: null } } };
  try {
    await expect(callSync(f.ports, origin, "runtime-callback.event", args)).rejects.toMatchObject({ code: "forbidden" });
    expect(delivered).toBe(0);
    expect((await callSync(f.ports, kernelOrigin(f.workspaceId), "runtime-callback.event", args)).output).toBeNull();
    expect(delivered).toBe(1);
    const other = await f.db.workspace.create({ data: { name: "foreign" } });
    await expect(callSync(f.ports, kernelOrigin(other.id), "runtime-callback.event", args)).rejects.toMatchObject({ code: "not_found" });
  } finally { callback.release(); }
  await expect(callSync(f.ports, kernelOrigin(f.workspaceId), "runtime-callback.event", args)).rejects.toMatchObject({ code: "not_found" });
  expect(delivered).toBe(1);
  expect(await f.db.run.count()).toBe(0);
});
test("retired contribution declarations are rejected instead of granting a kernel discovery surface", async () => {
  registerSystemModules();
  const manifest = { name: "ordinary", entry: "index.ts", tests: ["test.ts"], effects: [] };
  for (const contributes of [{ memory: { interface: 1, context: "conversation-context" } }, { private: { hidden: true } }]) {
    const parsed = moduleManifestSchema.safeParse({ ...manifest, contributes });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues).toContainEqual(expect.objectContaining({ code: "unrecognized_keys", keys: ["contributes"] }));
  }
  const f = await fixture(), entry = await f.app("entry-test", { uses: ["*"],
      authority: "owner"
});
  await expect(callSync(f.ports, { workspaceId: f.workspaceId, caller: entry, chain: [], path: [] }, "modules.contributions", { section: "memory" })).rejects.toMatchObject({ code: "not_found" });
});
test("app-owned memory selection discovers only the actual current approved memory tool contracts", async () => {
  registerSystemModules();
  const f = await fixture(), entry = await f.app("entry-test", { uses: ["modules.describe"] });
  const memory = await f.app("memory-local", memoryManifest);
  const origin = { workspaceId: f.workspaceId, caller: entry, chain: [], path: [] };
  const read = () => callSync(f.ports, origin, "modules.describe", { query: "memory-local" });
  const config = { provider: "memory-local", autoRecall: true, autoRetain: false };
  const selected = () => selectedMemory(async (target, args) => { if (target === "entry-test.settings") return config; const output = (await callSync(f.ports, origin, target, args ?? {})).output as { items: { target: { tool: string } }[] }; return { ...output, items: output.items.map(tool => ({ ...tool, target: `memory-local.${tool.target.tool}` })) }; }, "entry-test");
  const tools = ((await read()).output as { items: { target: { moduleId: string; tool: string }; moduleId: string; hash: string; contractHash: string }[] }).items;
  const declared = moduleManifestSchema.parse(memoryManifest).tools;
  expect(tools.map(tool => `memory-local.${tool.target.tool}`).sort()).toEqual(declared.filter(tool => tool.visibility.includes("modules")).map(tool => `memory-local.${tool.name}`).sort());
  for (const tool of tools) expect(tool).toMatchObject({ moduleId: memory.moduleId, hash: memory.hash, contractHash: moduleCallbackContractHash(declared.find(candidate => tool.target.tool === candidate.name)!) });
  expect(await selected()).toMatchObject({ ...config, module: "memory-local", available: true });
  expect([...(await selected()).tools].sort()).toEqual(["conversation-context", "conversation-retain", "forget", "preferences", "recall"]);
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: memory.moduleId, hash: memory.hash } }, data: { status: "rejected" } });
  expect((await read()).output).toEqual({ items: [], nextCursor: null });
  expect(await selected()).toMatchObject({ available: false, tools: new Set() });
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: memory.moduleId, hash: memory.hash } }, data: { status: "approved" } });
  await f.db.module.update({ where: { id: memory.moduleId }, data: { activeHash: "unapproved" } });
  expect((await read()).output).toEqual({ items: [], nextCursor: null });
  await f.db.module.update({ where: { id: memory.moduleId }, data: { activeHash: memory.hash, status: "paused" } });
  expect((await read()).output).toEqual({ items: [], nextCursor: null });
  await f.db.module.update({ where: { id: memory.moduleId }, data: { status: "active" } });
  expect((await selected()).available).toBe(true);
});
test("resolving a legacy session-linked approval never resurrects a retired conversation Run", async () => {
  const f = await fixture();
  const session = await f.db.session.create({ data: { workspaceId: f.workspaceId, source: "rescue", key: "old", title: "Old", status: "waiting_approval" } });
  const api = createApprovals({ ...f.ports, workspaceId: f.workspaceId });
  const approval = await api.create({ action: "delete_data", title: "Old request", detail: "", preview: "", payload: { sessionId: session.id } });
  await api.resolve(approval.id, { decision: "approve", scope: "once" });
  expect(await f.db.run.count({ where: { workspaceId: f.workspaceId } })).toBe(0);
  expect((await f.db.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("waiting_approval");
  expect((await f.db.approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("approved");
  expect(await f.db.grant.count({ where: { workspaceId: f.workspaceId } })).toBe(0);
});
