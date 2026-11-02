import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostPathsFor } from "./grants";
import { suggestHabits, weeklyHabits, type Decision } from "./approval-habits";
import { createApprovals } from "./approvals";
import { decidePolicy } from "@chrona/domain/steward/policy";
import { toGrant } from "./store";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const now = new Date("2026-10-27T12:00:00Z");
const ago = (hours: number, seconds = 0) => new Date(now.getTime() - hours * 3600_000 + seconds * 1000);
let n = 0;
const row = (part: Partial<Decision>): Decision => ({ id: `a${n++}`, action: "schedule", level: "yellow", status: "approved", title: "日程", moduleId: null, moduleName: null, kind: null, createdAt: ago(24), resolvedAt: ago(24, 60), ...part });
const times = (count: number, part: Partial<Decision>) => Array.from({ length: count }, () => row(part));

test.each([
  ["five approved Provider requests of one kind", times(5, {}), ["stop_asking"]],
  ["host paths are approved per directory, never as a kind", times(5, { action: "access_host_path" }), []],
  ["four are not enough", times(4, {}), []],
  ["one denial stops the suggestion", [...times(5, {}), row({ status: "denied" })], []],
  ["older than a week does not count", times(5, { createdAt: ago(24 * 8), resolvedAt: ago(24 * 8, 60) }), []],
  ["a module's requests are decided each time", times(5, { moduleId: "m", kind: "module_request", action: "modify_external" }), []],
  ["red kinds are never suggested", times(5, { action: "send_external_message", level: "red", resolvedAt: ago(24, 60) }), []],
  ["red approved within seconds", times(3, { action: "delete_data", level: "red", resolvedAt: ago(24, 4) }), ["read_red"]],
  ["red read carefully", times(3, { action: "delete_data", level: "red", resolvedAt: ago(24, 40) }), []],
  ["a module's updates denied three times", times(3, { action: "activate_module", moduleId: "m", moduleName: "trader", status: "denied" }), ["denied_module"]],
  ["waiting more than three days", [row({ status: "open", resolvedAt: null, createdAt: ago(80) })], ["waiting"]],
] as const)("weekly suggestion: %s", (_, decisions, kinds) => {
  expect(suggestHabits([...decisions], now).map(item => item.kind)).toEqual([...kinds]);
});

test("the weekly job runs once a week, tells the user in the digest, and a stop-asking suggestion loosens only when approved on the page", async () => {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-habits-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "habits" } });
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null };
  for (let i = 0; i < 5; i++) await db.approval.create({ data: { workspaceId: workspace.id, action: "schedule", title: "日程", detail: "", preview: "", payload: {}, level: "yellow", status: "approved", createdAt: ago(24), resolvedAt: ago(23) } });
  expect((await weeklyHabits(ports, workspace.id)).map(item => item.kind)).toEqual(["stop_asking"]);
  expect(await weeklyHabits(ports, workspace.id)).toEqual([]);
  const card = await db.approval.findFirstOrThrow({ where: { status: "open" } });
  expect(card).toMatchObject({ action: "change_policy", level: "red", title: "以后不再询问：设置日程", payload: { kind: "grant_suggestion", action: "schedule" } });
  const approvals = createApprovals({ db, workspaceId: workspace.id, now: () => now }, undefined, ports);
  await expect(approvals.resolve(card.id, { decision: "approve", scope: "once" }, "qq")).rejects.toMatchObject({ code: "forbidden" });
  const { grantId } = await approvals.resolve(card.id, { decision: "approve", scope: "once" }, "web");
  expect(await db.grant.findUniqueOrThrow({ where: { id: grantId! } })).toMatchObject({ action: "schedule", mode: "preapproved", once: false, scope: { kind: "global" } });
  expect(decidePolicy("schedule", {}, (await db.grant.findMany()).map(toGrant), now).mode).toBe("preapproved");
  expect(await db.grant.count()).toBe(1);
  // A tampered suggestion cannot pre-approve a red kind.
  const forged = await approvals.create({ action: "change_policy", title: "x", detail: "", preview: "", payload: { kind: "grant_suggestion", action: "purchase" } });
  await expect(approvals.resolve(forged.id, { decision: "approve", scope: "once" }, "web")).rejects.toMatchObject({ code: "invalid" });
});

test("a host directory approved always (from chat) stays mounted; another directory still asks, and none can be pre-approved as a kind", async () => {
  const db = testDb(); cleanups.push(() => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "paths" } });
  const approvals = createApprovals({ db, workspaceId: workspace.id, now: () => now });
  const ask = (path: string) => approvals.create({ action: "access_host_path", title: `访问 ${path}`, detail: "", preview: "", payload: { kind: "host_path", path } });
  const kept = await ask("/work/career-ops"), other = await ask("/work/private");
  expect(kept.level).toBe("yellow");
  await approvals.resolve(kept.id, { decision: "approve", scope: "always" }, "qq");
  await approvals.resolve(other.id, { decision: "approve", scope: "once" }, "qq");
  expect(await hostPathsFor(db, workspace.id, [], now)).toEqual(["/work/career-ops", "/work/private"]);
  expect(await hostPathsFor(db, workspace.id, [], now)).toEqual(["/work/career-ops"]);
  const forged = await approvals.create({ action: "change_policy", title: "x", detail: "", preview: "", payload: { kind: "grant_suggestion", action: "access_host_path" } });
  await expect(approvals.resolve(forged.id, { decision: "approve", scope: "once" }, "web")).rejects.toMatchObject({ code: "invalid" });
});
