import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "./test-db";
import webManifest from "./external/web/module.json";
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
  expect(await db.message.count()).toBe(0);
});
test("build reports stay in their build, and removed native tools stay unavailable", async () => {
  await db.session.update({ where: { id: sessionId }, data: { source: "build" } });
  const run = await capability(), tools = createTools(ports);
  expect(await tools.call(run.token, "chrona_reply", { text: "Answer" })).toHaveProperty("messageId");
  expect(await db.message.findFirst({ where: { sessionId } })).toMatchObject({ text: "Answer" });
  for (const name of ["chrona_session_search", "chrona_schedule", "chrona_notify", "chrona_request_approval"]) await expect(tools.call(run.token, name, {})).rejects.toMatchObject({ code: "invalid" });
});

test("service approvals persist facts transactionally without a notification app or backfill", async () => {
  const approvals = createApprovals({ ...ports, workspaceId });
  const requested = await approvals.create({ action: "delete_data", title: "请求", detail: "说明", preview: "摘要", payload: { privateArgument: "not-a-fact" } });
  const facts = await db.audit.findMany({ where: { workspaceId, kind: "kernel_fact_pending" } });
  expect(facts.map(row => (row.details as { data: { approval: string } }).data.approval).sort()).toEqual([requested.id]);
  expect(JSON.stringify(facts)).not.toContain("privateArgument");
  await approvals.resolve(requested.id, { decision: "deny", scope: "once" });
  expect(await db.audit.findFirst({ where: { workspaceId, kind: "kernel_fact_pending", details: { path: "$.type", equals: "withdraw" } } })).toMatchObject({ details: { data: { key: `approval:${requested.id}` } } });
  expect(await db.moduleInvocation.count({ where: { workspaceId } })).toBe(0);
});
test("reply files go to their recipient, never a shared attachment store or arbitrary app ref", async () => {
  const app = await db.module.create({ data: { workspaceId, name: "web", activeHash: "web" } });
  await db.moduleVersion.create({ data: { moduleId: app.id, hash: "web", status: "approved", source: "user", intent: {}, report: {}, manifest: webManifest } });
  await db.session.update({ where: { id: sessionId }, data: { source: "build", entryModuleId: app.id } });
  const run = await capability(), tools = createTools(ports);
  await mkdir(run.cwd, { recursive: true });
  await writeFile(join(run.cwd, "report.txt"), "done");
  const outside = join(ports.dataDir, "secret.txt"); await writeFile(outside, "secret");
  await symlink(outside, join(run.cwd, "link.txt"));
  const { messageId } = await tools.call(run.token, "chrona_reply", { text: "Here", files: ["report.txt"] }) as { messageId: string };
  const [file] = (await db.message.findUniqueOrThrow({ where: { id: messageId } })).attachments as { name: string; ref: string }[];
  expect(file!.name).toBe("report.txt");
  expect(file!.ref).toStartWith("web/outputs/");
  expect(await readFile(join(ports.dataDir, "platform/content", app.id, file!.ref.slice(4)), "utf8")).toBe("done");
  await expect(tools.call(run.token, "chrona_reply", { text: "No", files: ["link.txt"] })).rejects.toMatchObject({ code: "forbidden" });
  for (const path of ["content/chat/missing.txt", "content/image-generation/cat.png"]) await expect(tools.call(run.token, "chrona_reply", { text: "No", files: [path] })).rejects.toMatchObject({ code: "not_found" });
});
