import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp,} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "./test-db";
import { createRuns } from "./runs";
import { createApprovals } from "./approvals";
import { createTools } from "./tools";
import type { StewardPorts } from "./ports";
let db: ReturnType<typeof testDb>, ports: StewardPorts, workspaceId: string, sessionId: string;
beforeEach(async () => {
  db = testDb(); workspaceId = (await db.workspace.create({ data: { name: "tools" } })).id;
  sessionId = (await db.session.create({ data: { workspaceId, key: "web:tools", source: "web" } })).id;
  ports = { db, dataDir: await mkdtemp(join(tmpdir(), "chrona-tools-")), now: () => new Date("2026-10-15T04:00:00Z"), publicUrl: null };
});
afterEach(async () => { await db.$disconnect(); });
async function capability() {
  const runs = createRuns(ports, workspaceId);
  await runs.enqueue({ sessionId, lane: "foreground", trigger: "message", prompt: "Work" });
  return (await runs.claimNext("foreground"))!;
}
test("legacy Provider-native chat tools cannot revive a kernel conversation", async () => {
  const run = await capability(), tools = createTools(ports);
  expect(await tools.catalog(run.token)).toEqual([]);
  for (const name of ["chrona_reply", "chrona_session_search", "chrona_schedule", "chrona_notify", "chrona_remember"]) {
    await expect(tools.call(run.token, name, { text: "Answer" })).rejects.toMatchObject({ code: "forbidden" });
  }
});

test("service approvals persist facts transactionally without a notification app or backfill", async () => {
  const approvals = createApprovals({ ...ports, workspaceId });
  const requested = await approvals.create({ action: "delete_data", title: "请求", detail: "说明", preview: "摘要", payload: { privateArgument: "not-a-fact" } });
  const facts = await db.kernelFact.findMany({ where: { workspaceId, consumedAt: null } });
  expect(facts.map(row => (row.payload as { data: { approval: string } }).data.approval).sort()).toEqual([requested.id]);
  expect(JSON.stringify(facts)).not.toContain("privateArgument");
  await approvals.resolve(requested.id, { decision: "deny", scope: "once" });
  expect(await db.kernelFact.findFirst({ where: { workspaceId, consumedAt: null, payload: { path: "$.type", equals: "withdraw" } } })).toMatchObject({ payload: { data: { key: `approval:${requested.id}` } } });
  expect(await db.moduleInvocation.count({ where: { workspaceId } })).toBe(0);
});
