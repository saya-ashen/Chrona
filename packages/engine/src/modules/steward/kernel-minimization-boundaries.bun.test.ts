import { afterEach, expect, test } from "bun:test";
import { testDb } from "./test-db";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { registerSystemModules } from "./system-modules";
import { callSync } from "./module-calls";
import { createApprovals } from "./approvals";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function fixture() {
  const db = testDb(); cleanups.push(() => db.$disconnect());
  const workspaceId = (await db.workspace.create({ data: { name: "minimization-boundaries" } })).id;
  const ports: StewardPorts = { db, dataDir: "/unused", now: () => new Date("2026-11-08T12:00:00Z"), publicUrl: null };
  async function app(name: string, extra: Record<string, unknown> = {}) {
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [], triggers: [], ...extra });
    const row = await db.module.create({ data: { workspaceId, name, activeHash: "approved" } });
    await db.moduleVersion.create({ data: { moduleId: row.id, hash: "approved", status: "approved", manifest, intent: {}, source: "", report: {} } });
    return { kind: "module" as const, module: name, moduleId: row.id, hash: "approved" };
  }
  return { db, workspaceId, ports, app };
}
test("only current approved entry identities discover memory contributions; private declarations stay private", async () => {
  registerSystemModules();
  const f = await fixture(), entry = await f.app("entry-test", { uses: ["*"] }), ordinary = await f.app("ordinary");
  const memory = await f.app("memory-local", { contributes: { memory: { interface: 1, context: "conversation-context" }, private: { hidden: true } } });
  const read = (caller: typeof entry, section = "memory") => callSync(f.ports, { workspaceId: f.workspaceId, caller, chain: [], path: [] }, "modules.contributions", { section });
  expect((await read(entry)).output).toEqual([{ module: "memory-local", hash: "approved", value: { interface: 1, context: "conversation-context" } }]);
  await expect(read(ordinary)).rejects.toMatchObject({ code: "forbidden" });
  await expect(read(entry, "private")).rejects.toMatchObject({ code: "forbidden" });
  await expect(read({ ...entry, hash: "stale" })).rejects.toMatchObject({ code: "forbidden" });
  await f.db.module.update({ where: { id: entry.moduleId }, data: { status: "paused" } });
  await expect(read(entry)).rejects.toMatchObject({ code: "forbidden" });
  await f.db.module.update({ where: { id: entry.moduleId }, data: { status: "active" } });
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: memory.moduleId, hash: memory.hash } }, data: { status: "rejected" } });
  expect((await read(entry)).output).toEqual([]);
});
test("resolving a legacy session-linked approval never resurrects a retired conversation Run", async () => {
  const f = await fixture();
  const session = await f.db.session.create({ data: { workspaceId: f.workspaceId, source: "rescue", key: "old", title: "Old", status: "waiting_approval" } });
  const api = createApprovals({ ...f.ports, workspaceId: f.workspaceId });
  const approval = await api.create({ action: "delete_data", title: "Old request", detail: "", preview: "", payload: { sessionId: session.id } });
  await api.resolve(approval.id, { decision: "approve", scope: "once" });
  expect(await f.db.run.count({ where: { workspaceId: f.workspaceId } })).toBe(0);
  expect((await f.db.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("waiting_approval");
  expect(await f.db.grant.count({ where: { workspaceId: f.workspaceId, action: "delete_data" } })).toBe(1);
});
