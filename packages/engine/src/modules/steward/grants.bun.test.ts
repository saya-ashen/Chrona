import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { moduleContext } from "./module-context";
import { onApproved } from "./module-activation";
import { createApprovals } from "./approvals";
import { consumeOnce, createGrants, hostPathsFor } from "./grants";
import { testDb } from "./test-db";

const dbs: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of dbs.splice(0)) await db.$disconnect(); });
async function fixture() {
  const db = testDb(); dbs.push(db);
  const workspace = await db.workspace.create({ data: { name: "grant test" } });
  const context = { db, workspaceId: workspace.id, now: () => new Date("2026-11-03T12:00:00Z") };
  return { ...context, approvals: createApprovals(context), grants: createGrants(context) };
}

test.each(["once", "always"] as const)("runtime approval %s leaves a global or module allow grant", async scope => {
  const f = await fixture();
  const module = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "mail" } });
  for (const moduleId of [undefined, module.id]) {
    const approval = await f.approvals.create({ action: "send_external_message", moduleId, title: "Send", detail: "", preview: "", payload: {} });
    const resolved = await f.approvals.resolve(approval.id, { decision: "approve", scope });
    expect(resolved.grantId).toBeString();
    expect(await f.db.grant.findUniqueOrThrow({ where: { id: resolved.grantId! } })).toMatchObject({
      action: "send_external_message", mode: "allow", once: scope === "once", consumedAt: null,
      scope: moduleId ? { kind: "module", moduleId } : { kind: "global" },
    });
  }
});

test("a once approval overrides a standing ask rule until the resumed action consumes it", async () => {
  const f = await fixture();
  await f.grants.create({ action: "schedule", mode: "ask", scope: { kind: "global" } });
  const approval = await f.approvals.create({ action: "schedule", title: "Schedule", detail: "", preview: "", payload: {} });
  const resolved = await f.approvals.resolve(approval.id, { decision: "approve", scope: "once" });
  expect(await f.grants.effectivePolicy("schedule", {})).toMatchObject({ mode: "allow", grantId: resolved.grantId });
  await consumeOnce(f.db, f.workspaceId, resolved.grantId!, f.now());
  expect(await f.grants.effectivePolicy("schedule", {})).toMatchObject({ mode: "ask" });
  await expect(consumeOnce(f.db, f.workspaceId, resolved.grantId!, f.now())).rejects.toMatchObject({ code: "conflict" });
});

test.each(["once", "always"] as const)("host-path mount consumes only a once approval: %s", async scope => {
  const f = await fixture();
  const approval = await f.approvals.create({ action: "access_host_path", title: "Mount", detail: "", preview: "", payload: { kind: "host_path", path: "/tmp/grant-test" } });
  const resolved = await f.approvals.resolve(approval.id, { decision: "approve", scope });
  expect(await hostPathsFor(f.db, f.workspaceId, [], f.now())).toEqual(["/tmp/grant-test"]);
  expect(await hostPathsFor(f.db, f.workspaceId, [], f.now())).toEqual(scope === "once" ? [] : ["/tmp/grant-test"]);
  expect((await f.db.grant.findUniqueOrThrow({ where: { id: resolved.grantId! } })).consumedAt).toEqual(scope === "once" ? f.now() : null);
});

test("group activation matches approval id and payload without creating or checking grants", async () => {
  const f = await fixture(), dataDir = await mkdtemp(join(tmpdir(), "chrona-grant-group-"));
  try {
    const context = moduleContext({ ...f, dataDir, publicUrl: null }, f.workspaceId);
    const versions = [];
    for (const name of ["alpha", "beta"]) {
      const module = await f.db.module.create({ data: { workspaceId: f.workspaceId, name } });
      const hash = name === "alpha" ? "a".repeat(64) : "b".repeat(64);
      await f.db.moduleVersion.create({ data: { moduleId: module.id, hash, status: "pending_review", source: "user", intent: {}, report: {}, manifest: { name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], triggers: [], effects: [], data: { schema: 1 } } } });
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
