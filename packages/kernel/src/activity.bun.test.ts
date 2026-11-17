import { afterEach, expect, test } from "bun:test";
import { activityRecords, activityRecordsOutput } from "./activity";
import { testDb } from "./__testing__/test-db";
import type { StewardPorts } from "./ports";

const dbs: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of dbs.splice(0)) await db.$disconnect(); });
async function fixture() {
  const db = testDb(); dbs.push(db);
  const w = (await db.workspace.create({ data: { name: "activity" } })).id;
  const web = await db.module.create({ data: { workspaceId: w, name: "web", activeHash: "5caef53c00" } });
  const version = await db.moduleVersion.create({ data: { moduleId: web.id, hash: "2a501daa00", manifest: {}, source: "provider", intent: {}, report: {}, status: "pending_review" } });
  const approval = await db.approval.create({ data: { workspaceId: w, moduleId: web.id, action: "activate_module", title: "启用模块 web", detail: "", preview: "", payload: {} } });
  let at = Date.parse("2026-10-27T04:00:00Z");
  const add = (kind: string, subjectId: string | null, details: object, actorKey = "chrona") => db.audit.create({ data: { workspaceId: w, kind, subjectId, actorKey, details, createdAt: new Date(at += 1000) } });
  const ports: StewardPorts = { db, dataDir: "/nonexistent", now: () => new Date(at), publicUrl: null };
  return { db, w, web, version, approval, add, ports };
}

test("audit facts exclude raw details, credentials and other workspaces", async () => {
  const f = await fixture();
  await f.add("settings_updated", null, { notifications: { token: "private-notification-credential" }, moduleModel: { apiKey: "private-model-credential" } });
  await f.add("module_runtime_incident", f.web.id, { id: "safe", status: "retrying", evidence: { reason: "token=private-token", raw: "private-raw" }, request: "private-request", token: "private-token" });
  const foreign = await f.db.workspace.create({ data: { name: "foreign" } });
  await f.db.audit.create({ data: { workspaceId: foreign.id, actorKey: "chrona", kind: "secret_set", details: { name: "foreign-name" } } });
  const facts = activityRecordsOutput.parse(await activityRecords(f.ports, f.w, {}));
  const encoded = JSON.stringify(facts);
  for (const value of ["private-notification-credential", "private-model-credential", "private-token", "private-raw", "private-request", "foreign-name"]) expect(encoded).not.toContain(value);
  expect(facts.rows.find(row => row.kind === "settings_updated")!.details).toEqual({ settingsKeys: ["notifications", "moduleModel"] });
  expect(facts.rows).toHaveLength(2);
});
