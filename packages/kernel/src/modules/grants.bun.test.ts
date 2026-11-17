import { afterEach, expect, test } from "bun:test";
import { createApprovals } from "../approvals";
import { testDb } from "../__testing__/test-db";

const dbs: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of dbs.splice(0)) await db.$disconnect(); });
async function fixture() {
  const db = testDb(); dbs.push(db);
  const workspace = await db.workspace.create({ data: { name: "grant test" } });
  const context = { db, workspaceId: workspace.id, now: () => new Date("2026-11-03T12:00:00Z") };
  return { ...context, approvals: createApprovals(context) };
}

test.each(["modify_external", "delete_data"] as const)("%s approval records a once decision without creating grants", async action => {
  const f = await fixture();
  const module = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "requester" } });
  for (const moduleId of [undefined, module.id]) {
    const approval = await f.approvals.create({ action, moduleId, title: "Decide", detail: "", preview: "", payload: {} });
    await expect(f.approvals.resolve(approval.id, { decision: "approve", scope: "always" })).rejects.toMatchObject({ code: "invalid" });
    const resolved = await f.approvals.resolve(approval.id, { decision: "approve" });
    expect(resolved.approval.status).toBe("approved");
    expect(await f.db.approval.findUniqueOrThrow({ where: { id: approval.id } })).toMatchObject({ status: "approved", action, moduleId: moduleId ?? null });
  }

});
