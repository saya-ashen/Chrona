import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { moduleContext } from "./module-context";
import { onApproved } from "./module-activation";
import { createApprovals } from "./approvals";
import { testDb } from "./test-db";

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
    expect(await f.db.approval.findUniqueOrThrow({ where: { id: approval.id } })).toMatchObject({ status: "approved", scope: "once", grantId: null });
    expect(resolved.grantId).toBeNull();
  }
  expect(await f.db.grant.count()).toBe(0);
});

test("group activation matches approval id and payload without creating or checking grants", async () => {
  const f = await fixture(), dataDir = await mkdtemp(join(tmpdir(), "chrona-grant-group-"));
  try {
    const context = moduleContext({ ...f, dataDir, publicUrl: null }, f.workspaceId);
    const versions = [];
    for (const name of ["alpha", "beta"]) {
      const module = await f.db.module.create({ data: { workspaceId: f.workspaceId, name } });
      const hash = name === "alpha" ? "a".repeat(64) : "b".repeat(64);
      await f.db.moduleVersion.create({ data: { moduleId: module.id, hash, status: "pending_review", source: "user", intent: {}, report: {}, manifest: { name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [], data: { schema: 1 } } } });
      versions.push({ moduleId: module.id, hash });
    }
    const payload = { kind: "activate_modules", versions };
    const approval = await f.approvals.create({ action: "activate_module", title: "Group", detail: "", preview: "", payload });
    await expect(f.approvals.resolve(approval.id, { decision: "approve", scope: "always" })).rejects.toMatchObject({ code: "invalid" });
    const resolved = await f.approvals.resolve(approval.id, { decision: "approve", scope: "once" });
    expect(resolved.grantId).toBeNull();
    const action = { workspaceId: f.workspaceId, approvalId: approval.id, payload };
    await expect(onApproved(context, { ...action, approvalId: "wrong-id" })).rejects.toMatchObject({ code: "conflict" });
    await expect(onApproved(context, { ...action, payload: { ...payload, versions: [...versions].reverse() } })).rejects.toMatchObject({ code: "conflict" });
    await onApproved(context, action);
    for (const version of versions) expect(await f.db.module.findUniqueOrThrow({ where: { id: version.moduleId } })).toMatchObject({ activeHash: version.hash });
    expect(await f.db.generation.count()).toBe(1);
    expect(await f.db.grant.count()).toBe(0);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});
