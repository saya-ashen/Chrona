import { afterEach, expect, test } from "bun:test";
import { testDb } from "./__testing__/test-db";
import { createApprovals } from "./approvals";

const dbs: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of dbs.splice(0)) await db.$disconnect(); });
async function fixture() {
  const db = testDb(); dbs.push(db);
  const workspace = await db.workspace.create({ data: { name: "approval entry sources" } });
  const approvals = createApprovals({ db, workspaceId: workspace.id, now: () => new Date() });
  return { db, workspace, approvals };
}
test.each(["entry", "web", "mcp", "qq", "cli", "custom-entry"] as const)("entry-module and application-requested approvals resolve from any source: %s", async source => {
  const { db, workspace, approvals } = await fixture();
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "entry" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "a".repeat(64), manifest: { name: "entry", entry: "index.ts", keepAlive: true, effects: [], uses: ["chat.send"], tests: ["test.ts"] }, intent: {}, source: "user", report: {}, status: "pending_review" } });
  const entry = await approvals.create({ action: "activate_module", moduleId: module.id, title: "Enable", detail: "Review", preview: "diff", payload: { kind: "activate_module", moduleId: module.id, hash: "a".repeat(64) } });
  const requested = await approvals.create({ action: "modify_external", title: "Update", detail: "Review", preview: "external diff", payload: { kind: "external_update" } });
  expect((await approvals.resolve(entry.id, { decision: "deny" }, source)).approval.status).toBe("denied");
  expect((await approvals.resolve(requested.id, { decision: "deny" }, source)).approval.status).toBe("denied");
  expect(await db.audit.findFirst({ where: { kind: "approval_resolved", subjectId: requested.id } })).toMatchObject({ actorKey: "user", details: { source } });
});
