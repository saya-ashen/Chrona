import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHRONA_TOOLS } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import webManifest from "./builtin/web/module.json";
import { createRuns } from "./runs";
import { createApprovals } from "./approvals";
import { announceApprovals } from "./notify-user";
import { createTools, searchSessions } from "./tools";
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
test("search groups bounded snippets by session, includes ended history and isolates workspaces", async () => {
  const ended = await db.session.create({ data: { workspaceId, key: "web:old", source: "web", status: "ended", title: "Old context" } });
  await db.message.createMany({ data: [
    { workspaceId, sessionId, direction: "in", channel: "in_app", text: "Remember the telescope" },
    { workspaceId, sessionId, direction: "out", channel: "in_app", text: "Telescope details" },
    { workspaceId, sessionId: ended.id, direction: "out", channel: "in_app", text: "An old telescope" },
  ] });
  const other = await db.workspace.create({ data: { name: "Other" } });
  const foreign = await db.session.create({ data: { workspaceId: other.id, key: "web:foreign", source: "web" } });
  await db.message.create({ data: { workspaceId: other.id, sessionId: foreign.id, direction: "in", channel: "in_app", text: "Secret telescope" } });
  const results = await searchSessions(db, workspaceId, "telescope", 10);
  expect(results).toHaveLength(2);
  expect(results.find(result => result.sessionId === sessionId)?.snippets).toHaveLength(2);
  expect(results.find(result => result.sessionId === ended.id)?.title).toBe("Old context");
  expect(JSON.stringify(results)).not.toContain("Secret");
  expect(await searchSessions(db, workspaceId, "%")).toEqual([]);
  expect(await searchSessions(db, workspaceId, "telescope", 1)).toHaveLength(1);
});
test("session search tool and foreground reply match the contract", async () => {
  const run = await capability(), tools = createTools(ports);
  expect(CHRONA_TOOLS).toContain("chrona_session_search");
  const result = await tools.call(run.token, "chrona_reply", { text: "Answer" });
  expect(result).toHaveProperty("messageId");
  const messages = await db.message.findMany({ where: { sessionId } });
  expect(messages[0]?.text).toBe("Answer");
  expect(await tools.call(run.token, "chrona_session_search", { query: "Answer" })).toHaveLength(1);
});

test("tool policy approvals, service approvals and legacy backfill persist facts without a notification app", async () => {
  const run = await capability(), tools = createTools(ports);
  await db.grant.create({ data: { workspaceId, action: "notify_user", mode: "ask", scope: { kind: "global" } } });
  const gated = await tools.call(run.token, "chrona_notify", { level: "now", title: "通知", body: "正文" }) as { approvalId: string; status: string };
  expect(gated.status).toBe("awaiting_approval");
  const approvals = createApprovals({ ...ports, workspaceId });
  const requested = await approvals.create({ action: "delete_data", title: "请求", detail: "说明", preview: "摘要", payload: { privateArgument: "not-a-fact" } });
  const legacy = await db.approval.create({ data: { workspaceId, action: "delete_data", title: "旧请求", detail: "", preview: "", payload: {} } });
  await announceApprovals(ports, workspaceId);
  await announceApprovals(ports, workspaceId);
  const facts = await db.audit.findMany({ where: { workspaceId, kind: "kernel_fact_pending" } });
  expect(facts.map(row => (row.details as { data: { approval: string } }).data.approval).sort()).toEqual([gated.approvalId, requested.id, legacy.id].sort());
  expect(JSON.stringify(facts)).not.toContain("privateArgument");
  await approvals.resolve(gated.approvalId, { decision: "deny", scope: "once" });
  expect(await db.audit.findFirst({ where: { workspaceId, kind: "kernel_fact_pending", details: { path: "$.type", equals: "withdraw" } } })).toMatchObject({ details: { data: { key: `approval:${gated.approvalId}` } } });
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
