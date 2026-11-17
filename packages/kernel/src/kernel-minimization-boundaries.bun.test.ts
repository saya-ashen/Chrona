import { afterEach, expect, test } from "bun:test";
import { testDb } from "./__testing__/test-db";
import { BUILTIN_MODULE_NAMES, KERNEL_MODULE_NAMES, moduleManifestSchema } from "@chrona/contracts/steward";
import { registerSystemModules } from "./system/system-modules";
import { callSync, kernelOrigin, listLocalModules } from "./modules/module-calls";
import { moduleTools } from "./modules/module-tools";
import { registerProviderCallbacks, retainProviderCallbacks } from "./agent/local-provider";
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
test("private event host stays undiscoverable and accepts only its admitted Provider module version", async () => {
  registerSystemModules(); registerProviderCallbacks();
  const f = await fixture(), ordinary = await f.app("ordinary", { uses: ["*"], authority: "owner" });
  const provider = await f.app("pi", { uses: ["runtime-callback.event"] });
  const providerOrigin = { workspaceId: f.workspaceId, caller: provider, chain: [], path: [] };
  const host = listLocalModules().find(module => module.name === "runtime-callback");
  expect(host?.tools.map(tool => tool.name).sort()).toEqual(["event"]);
  for (const audience of ["owner", "provider", "modules"] as const) {
    expect((await moduleTools(f.ports, { workspaceId: f.workspaceId, audience })).some(tool => tool.module.name === "runtime-callback")).toBe(false);
  }
  for (const caller of [ordinary, { kind: "owner" as const, via: null }, { kind: "provider" as const, runId: "run" }]) {
    const reply = await callSync(f.ports, { workspaceId: f.workspaceId, caller, chain: [], path: [] }, "modules.describe", {});
    expect((reply.output as { items: { target: unknown }[] }).items.some(tool => typeof tool.target === "string" && tool.target.startsWith("runtime-callback."))).toBe(false);
  }
  const origin = { workspaceId: f.workspaceId, caller: ordinary, chain: [], path: [] };
  await expect(callSync(f.ports, origin, "runtime-callback.agent-admit", { callId: "forged", operation: "run" })).rejects.toMatchObject({ code: "not_found" });
  await expect(callSync(f.ports, origin, "runtime-callback.agent-settle", { reservationId: "forged", failed: true })).rejects.toMatchObject({ code: "not_found" });
  let delivered = 0;
  const callback = retainProviderCallbacks(f.ports, f.workspaceId, { provider: { moduleId: provider.moduleId, hash: provider.hash }, events: { progress: async () => { delivered++; }, usage: async () => {}, resources: async () => {}, question: async () => ({ decision: "cancel" }) } });
  const args = { callbackId: callback.id, event: { kind: "progress", value: { phase: "thinking", tool: null } } };
  try {
    await expect(callSync(f.ports, origin, "runtime-callback.event", args)).rejects.toMatchObject({ code: "forbidden" });
    await expect(callSync(f.ports, kernelOrigin(f.workspaceId), "runtime-callback.event", args)).rejects.toMatchObject({ code: "forbidden" });
    await expect(callSync(f.ports, { ...providerOrigin, caller: { ...provider, hash: "another-version" } }, "runtime-callback.event", args)).rejects.toMatchObject({ code: "forbidden" });
    await f.db.module.update({ where: { id: provider.moduleId }, data: { status: "paused" } });
    await expect(callSync(f.ports, providerOrigin, "runtime-callback.event", args)).rejects.toMatchObject({ code: "forbidden" });
    await f.db.module.update({ where: { id: provider.moduleId }, data: { status: "active" } });
    expect(delivered).toBe(0);
    expect((await callSync(f.ports, providerOrigin, "runtime-callback.event", args)).output).toBeNull();
    expect(delivered).toBe(1);
    const other = await f.db.workspace.create({ data: { name: "foreign" } });
    await expect(callSync(f.ports, kernelOrigin(other.id), "runtime-callback.event", args)).rejects.toMatchObject({ code: "not_found" });
  } finally { callback.release(); }
  await expect(callSync(f.ports, providerOrigin, "runtime-callback.event", args)).rejects.toMatchObject({ code: "not_found" });
  expect(delivered).toBe(1);
  expect(await f.db.run.count()).toBe(0);
});
test("Agent is a reserved kernel manifest name while approved Pi is an ordinary module", async () => {
  expect(KERNEL_MODULE_NAMES).toContain("agent");
  expect(BUILTIN_MODULE_NAMES).toEqual([]);
  const parsed = moduleManifestSchema.safeParse({ name: "agent", entry: "index.ts", tests: ["test.ts"], effects: [] });
  expect(parsed.success).toBe(false);
  if (!parsed.success) expect(parsed.error.issues).toContainEqual(expect.objectContaining({ path: ["name"], code: "custom", message: "Name is reserved for a Chrona system module" }));
  const f = await fixture(), pi = await f.app("pi");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: pi.moduleId } })).toMatchObject({ name: "pi", builtin: false, activeHash: pi.hash });
  expect(await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: pi.moduleId, hash: pi.hash } } })).toMatchObject({ status: "approved" });
  expect(await f.db.module.count({ where: { workspaceId: f.workspaceId, name: "agent" } })).toBe(0);
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
test("tool discovery exposes only the current approved application version", async () => {
  registerSystemModules();
  const f = await fixture(), entry = await f.app("entry-test", { uses: ["modules.describe"] });
  const application = await f.app("fixture-app", { tools: [{ name: "read", description: "Read fixture data", visibility: ["modules"], parameters: { type: "object", properties: {} }, output: { type: "object", properties: {}, additionalProperties: false } }] });
  const origin = { workspaceId: f.workspaceId, caller: entry, chain: [], path: [] };
  const read = () => callSync(f.ports, origin, "modules.describe", { query: "fixture-app" });
  const tools = ((await read()).output as { items: { target: { moduleId: string; tool: string }; moduleId: string; hash: string }[] }).items;
  expect(tools.map(tool => `fixture-app.${tool.target.tool}`).sort()).toEqual(["fixture-app.read"]);
  for (const tool of tools) expect(tool).toMatchObject({ moduleId: application.moduleId, hash: application.hash });
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: application.moduleId, hash: application.hash } }, data: { status: "rejected" } });
  expect((await read()).output).toEqual({ items: [], nextCursor: null });
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: application.moduleId, hash: application.hash } }, data: { status: "approved" } });
  await f.db.module.update({ where: { id: application.moduleId }, data: { activeHash: "unapproved" } });
  expect((await read()).output).toEqual({ items: [], nextCursor: null });
  await f.db.module.update({ where: { id: application.moduleId }, data: { activeHash: application.hash, status: "paused" } });
  expect((await read()).output).toEqual({ items: [], nextCursor: null });
  await f.db.module.update({ where: { id: application.moduleId }, data: { status: "active" } });
  expect((await read()).output).toMatchObject({ items: [{ target: { moduleId: application.moduleId, tool: "read" } }] });
});
test("resolving a legacy session-linked approval never resurrects a retired conversation Run", async () => {
  const f = await fixture();
  const session = await f.db.session.create({ data: { workspaceId: f.workspaceId, source: "module", key: "old", title: "Old", status: "waiting_approval" } });
  const api = createApprovals({ ...f.ports, workspaceId: f.workspaceId });
  const approval = await api.create({ action: "delete_data", title: "Old request", detail: "", preview: "", payload: { sessionId: session.id } });
  await api.resolve(approval.id, { decision: "approve", scope: "once" });
  expect(await f.db.run.count({ where: { workspaceId: f.workspaceId } })).toBe(0);
  expect((await f.db.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("waiting_approval");
  expect((await f.db.approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("approved");

});
