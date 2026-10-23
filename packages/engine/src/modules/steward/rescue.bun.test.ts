import { afterEach, expect, test } from "bun:test";
import { testDb } from "./test-db";
import { createApprovals } from "./approvals";

const dbs: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of dbs.splice(0)) await db.$disconnect(); });
async function fixture() {
  const db = testDb(); dbs.push(db);
  const workspace = await db.workspace.create({ data: { name: "rescue test" } });
  const approvals = createApprovals({ db, workspaceId: workspace.id, now: () => new Date() });
  return { db, workspace, approvals };
}
test.each(["owner", "notify_user"])("activation creation derives rescueOnly from version effects: %s", async effect => {
  const { db, workspace, approvals } = await fixture();
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "entry" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "a".repeat(64), manifest: { name: "entry", entry: "index.ts", keepAlive: true, triggers: [], effects: [effect], tests: ["test.ts"] }, intent: {}, source: "user", report: {}, status: "pending_review" } });
  const approval = await approvals.create({ action: "activate_module", moduleId: module.id, title: "Enable", detail: "Review", preview: "diff", payload: { kind: "activate_module", moduleId: module.id, hash: "a".repeat(64) } });
  expect(approval.rescueOnly).toBe(effect === "owner");
  expect((await approvals.list("open"))[0]!.rescueOnly).toBe(effect === "owner");
});
test.each(["entry", "web", "mcp", "qq", "rescue", "cli"] as const)("rescue-only resolution checks trusted source: %s", async source => {
  const { db, approvals } = await fixture();
  const approval = await approvals.create({ action: "change_policy", title: "Settings", detail: "Review", preview: "settings diff", payload: { kind: "change_policy" } });
  expect(approval.rescueOnly).toBe(true);
  const result = approvals.resolve(approval.id, { decision: "approve", scope: "once" }, source);
  if (source === "rescue" || source === "cli") {
    expect((await result).approval.status).toBe("approved");
    expect(await db.audit.findFirst({ where: { kind: "approval_resolved", subjectId: approval.id } })).toMatchObject({ actorKey: "user", details: { source } });
  } else {
    await expect(result).rejects.toMatchObject({ code: "forbidden", message: expect.stringContaining("rescue console") });
    expect((await approvals.list("open"))).toHaveLength(1);
    await expect(approvals.resolve(approval.id, { decision: "deny" }, source)).rejects.toMatchObject({ code: "forbidden" });
  }
});
test("ordinary approvals remain resolvable in other entries", async () => {
  const { approvals } = await fixture();
  const approval = await approvals.create({ action: "send_external_message", title: "Send", detail: "Review", preview: "draft", payload: {} });
  expect(approval.rescueOnly).toBe(false);
  expect((await approvals.resolve(approval.id, { decision: "deny" }, "web")).approval.status).toBe("denied");
});
