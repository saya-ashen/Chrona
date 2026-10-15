import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { createStewardTools, ToolNotFoundError } from "./tools";
import { createStewardWork } from "./work";
import { createStewardChat } from "./chat";
import { workResultContentSchema } from "@chrona/contracts/results";
import { createStewardDelivery } from "./delivery";
import { transactionAwareClient } from "@chrona/db/transaction-context";
import { workToolHandlers } from "./work-tools";
import type { HandlingSignals } from "@chrona/domain/steward/handling";

let db: PrismaClient, directory: string, tools: ReturnType<typeof createStewardTools>;
const at = new Date("2031-01-20T12:00:00Z");
beforeEach(async () => {
  directory = mkdtempSync(join(import.meta.dir, ".work-tools-test-")); const url = `file:${join(directory, "test.sqlite")}`;
  ensureSqliteDatabase({ databaseUrl: url, migrationsDir: resolve("prisma/migrations") });
  db = new PrismaClient({ adapter: new PrismaBunSqlite({ url }) }); tools = createStewardTools({ db, now: () => at });
  await db.workspace.createMany({ data: ["ws", "other"].map(id => ({ id, name: "Test only", status: "Active" })) });
  await db.managedTool.create({ data: { id: "draft", workspaceId: "ws", kind: "script", name: "Test draft", purpose: "Test only", handlingMode: "script", selectionRationale: "Test draft requires human review", state: "generated", spec: { type: "script_draft", language: "python", source: "print('test only')", usage: "Manual review", validationPlan: "Review first", risks: "Not run" }, validationSummary: "草稿未运行：Chrona 没有任意脚本沙箱，需人工审阅" } });
});
afterEach(async () => { await db?.$disconnect(); if (directory) rmSync(directory, { recursive: true, force: true }); });

test.each(["validate", "authorize", "enable"] as const)("script draft refuses %s without changing persisted state", async action => {
  const before = await db.managedTool.findUniqueOrThrow({ where: { id: "draft" } });
  await expect(tools.transition("ws", "draft", { action, expectedVersion: 1, actorKey: "test:owner" })).rejects.toMatchObject({ code: "SCRIPT_DRAFT_ONLY", message: expect.stringContaining("human review") });
  expect(await db.managedTool.findUniqueOrThrow({ where: { id: "draft" } })).toEqual(before);
  expect(await db.stewardAudit.count()).toBe(0);
});

test.each(["generated", "enabled"])("script draft refuses execution even when stored as %s, with a privacy-safe refusal audit", async state => {
  await db.managedTool.update({ where: { id: "draft" }, data: { state } });
  const before = await db.managedTool.findUniqueOrThrow({ where: { id: "draft" } });
  await expect(tools.run("ws", "draft", { events: [], actorKey: "test:owner" })).rejects.toMatchObject({ code: "SCRIPT_DRAFT_ONLY" });
  expect(await db.managedTool.findUniqueOrThrow({ where: { id: "draft" } })).toEqual(before);
  expect(await db.stewardAudit.findFirst()).toMatchObject({ workspaceId: "ws", kind: "tool.run_refused", details: { code: "SCRIPT_DRAFT_ONLY", version: 1 } });
  expect(JSON.stringify(await db.stewardAudit.findMany())).not.toContain("print(");
});

test("script-draft refusal does not reveal a tool across workspaces", async () => {
  await expect(tools.transition("other", "draft", { action: "validate", expectedVersion: 1 })).rejects.toBeInstanceOf(ToolNotFoundError);
  await expect(tools.run("other", "draft", { events: [], actorKey: "test:other" })).rejects.toBeInstanceOf(ToolNotFoundError);
  expect(await db.stewardAudit.count()).toBe(0);
});

const publication = { title: "Test result", summary: "Test summary", body: "Test body", handling: { mode: "direct_answer", rationale: "Test" } };
const identity = { route: "chrona_command" as const, platform: "qqbot" as const, chatType: "dm" as const, userId: "TEST", chatId: "TEST", messageId: "m", userText: "Test request" };
async function agent(chatBound = false) {
  const service = createStewardWork({ db, now: () => at, allowedRecipients: new Set(["qqbot:TEST"]) });
  const work = await service.create({ workspaceId: "ws", text: "Test request", ...(chatBound ? { chat: { identity, recipient: "qqbot:TEST" } } : {}) });
  const claim = (await service.claimDue())[0]!;
  return { service, work, claim };
}
test("multi-step publication uses result layer, verifies sources, chunks body and stops replay", async () => {
  const { service, claim, work } = await agent();
  await db.sourceConnection.create({ data: { workspaceId: "ws", kind: "local_test", label: "Test" } });
  for (const [tool, input] of [["chrona_get_context", {}], ["chrona_read_source", { connectionKind: "local_test" }], ["chrona_save_progress", { summary: "Test progress" }]] as const) expect(await service.callTool(claim.token, tool, input)).toMatchObject({ ok: true });
  await service.webObserved(claim.token, { tool: "fetch_content", urls: ["https://example.com/seen"] });
  const input = { ...publication, body: "a".repeat(17000), sources: [{ title: "Seen", url: "https://example.com/seen" }, { title: "Unseen", url: "https://example.com/unseen" }] };
  expect(await service.callTool(claim.token, "chrona_publish_result", input)).toMatchObject({ ok: true, data: { status: "result_ready" } });
  const row = await db.stewardWork.findUniqueOrThrow({ where: { id: work.workId } });
  const version = await db.taskResultVersion.findUniqueOrThrow({ where: { id: row.resultVersionId! } });
  const content = workResultContentSchema.parse(version.content);
  expect(content.readiness.status).toBe("ready_with_caveats"); expect(content.findings.map(f => f.content.length)).toEqual([8000, 8000, 1000]);
  expect(content.evidence[0]!.summary).toContain("本次检索取得"); expect(content.evidence[1]!.summary).toContain("未在本次检索中核实");
  expect(await service.view(row)).toMatchObject({ status: "result_ready", resultHref: `/tasks/${row.resultTaskId}/results` });
  expect(await service.callTool(claim.token, "chrona_publish_result", input)).toMatchObject({ error: { code: "STOPPED" } });
  await transactionAwareClient(db).$transaction(async tx => {
    const attempt = await tx.stewardWorkAttempt.findUniqueOrThrow({ where: { id: claim.attemptId } });
    const delegation = await tx.delegation.findUniqueOrThrow({ where: { id: work.delegationId } });
    await workToolHandlers.chrona_publish_result!({ tx, work: row, attempt, delegation, workspaceId: "ws", now: at }, input);
  });
  expect(await db.taskResultVersion.count()).toBe(1); expect(await db.resultCommand.count()).toBe(1);
  expect(await db.stewardNotification.count()).toBe(1);
  expect(await db.stewardNotification.findFirst()).toMatchObject({ status: "queued", link: `/affairs/${work.affairId}` });
  expect(await db.attentionItem.findFirst()).toMatchObject({ kind: "result", delegationId: work.delegationId });
});
test.each(["feedback", "confirm", "decline"] as const)("terminal decision resumes through item ref: %s", async action => {
  const allowedRecipients = new Set(["qqbot:TEST"]), service = createStewardWork({ db, now: () => at, allowedRecipients });
  const work = await service.create({ workspaceId: "ws", text: "Test", chat: { identity, recipient: "qqbot:TEST" } });
  const claim = (await service.claimDue())[0]!, chat = createStewardChat({ db, workspaceId: "ws", actorKey: "test", now: () => at, allowedRecipients });
  const ask = action === "feedback";
  expect(await service.callTool(claim.token, ask ? "chrona_ask_user" : "chrona_request_authorization", ask ? { questions: [{ question: "Which?", why: "Needed" }] } : { missing: "permission", capability: "New source", why: "Needed", howToGrant: "Connect in settings" })).toMatchObject({ ok: true });
  const item = await db.attentionItem.findFirstOrThrow(), grant = await db.delegation.findUniqueOrThrow({ where: { id: work.delegationId } });
  expect(await chat.respond({ requestId: crypto.randomUUID(), chat: { ...identity, userText: `${item.replyRef} ${action}` }, ref: item.replyRef!, action, ...(ask ? { note: "Answer" } : {}) })).toMatchObject({ state: action === "decline" ? "waiting_authorization" : "received" });
  expect(await db.delegation.findUnique({ where: { id: grant.id } })).toEqual(grant);
  if (action === "decline") { expect(await service.claimDue()).toEqual([]); return; }
  const next = (await service.claimDue())[0]!;
  expect(await service.callTool(next.token, "chrona_get_context", {})).toMatchObject({ data: { inputs: [{ kind: ask ? "answer" : "decision" }] } });
  expect(await service.callTool(next.token, "chrona_close_quietly", { reason: "quiet" })).toMatchObject({ error: { code: "NOT_ALLOWED" } });
  expect(await service.callTool(next.token, "chrona_publish_result", publication)).toMatchObject({ ok: true });
});
test("supervisor web inputs preserve bounded queries and fetch mode/prompt", async () => {
  const { service, claim } = await agent();
  expect(await service.webPreflight(claim.token, { tool: "web_search", input: {} })).toEqual({ allow: false, reason: "QUERY_REQUIRED" });
  expect(await service.webPreflight(claim.token, { tool: "web_search", input: { queries: ["a", "b", "c", "d", "e"] } })).toMatchObject({ allow: true, input: { queries: ["a", "b", "c", "d"] } });
  for (const mode of ["readable", "raw", "answer"]) expect(await service.webPreflight(claim.token, { tool: "fetch_content", input: { url: "https://example.com", mode, prompt: "Summarize" } })).toEqual({ allow: true, input: { url: "https://example.com", mode, prompt: "Summarize" } });
});
test("follow-up bounds, pending cap and resting wake allow quiet close", async () => {
  let clock = at; const service = createStewardWork({ db, now: () => clock, allowedRecipients: new Set() });
  const work = await service.create({ workspaceId: "ws", text: "Follow up" }), claim = (await service.claimDue())[0]!;
  const follow = (dueAt: Date) => service.callTool(claim.token, "chrona_propose_follow_up", { note: "Check again", reason: "Review", dueAt: dueAt.toISOString() });
  expect(await follow(at)).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  expect(await follow(new Date(at.getTime() + 91 * 86400_000))).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  for (let i = 1; i <= 3; i++) expect(await follow(new Date(at.getTime() + i * 60_000))).toMatchObject({ ok: true });
  expect(await follow(new Date(at.getTime() + 240_000))).toMatchObject({ error: { code: "LIMIT_REACHED" } });
  expect(await service.callTool(claim.token, "chrona_publish_result", publication)).toMatchObject({ ok: true });
  clock = new Date(at.getTime() + 60_000);
  expect(await service.wakeDueFollowUps()).toEqual({ woken: 1 });
  const next = (await service.claimDue())[0]!; expect(next.wakeReason).toBe("follow_up_due");
  expect(await service.callTool(next.token, "chrona_close_quietly", { reason: "No change" })).toMatchObject({ ok: true });
  expect(await db.stewardWork.findUnique({ where: { id: work.workId } })).toMatchObject({ status: "result_ready" });
});
test("revoked work suppresses queued notification before any adapter send", async () => {
  const { service, claim, work } = await agent();
  await service.callTool(claim.token, "chrona_ask_user", { questions: [{ question: "Which?", why: "Needed" }] });
  await db.delegation.update({ where: { id: work.delegationId }, data: { status: "revoked" } });
  let calls = 0;
  await createStewardDelivery({ db, workspaceId: "ws", now: () => at, adapters: { in_app: { channel: "in_app", async send() { calls++; return { outcome: "accepted", receiptRef: "test-only" }; } } } }).deliverDue();
  expect(calls).toBe(0); expect(await db.stewardNotification.findFirst()).toMatchObject({ status: "suppressed" });
});
test("source read is bounded, workspace-scoped and never polls or exposes config", async () => {
  const { service, claim } = await agent();
  await db.sourceConnection.create({ data: { workspaceId: "other", kind: "local_test", label: "Foreign", config: { secret: "test-only-secret" } } });
  expect(await service.callTool(claim.token, "chrona_read_source", { connectionKind: "local_test" })).toMatchObject({ error: { code: "SOURCE_NOT_CONNECTED" } });
  const c = await db.sourceConnection.create({ data: { workspaceId: "ws", kind: "local_test", label: "Own", coverageNote: "Test coverage", config: { secret: "test-only-secret" } } });
  for (let i = 0; i < 3; i++) await db.inboundEvent.create({ data: { workspaceId: "ws", connectionId: c.id, externalId: String(i), title: String(i).repeat(400), body: "data".repeat(300), author: "Test", occurredAt: new Date(at.getTime() + i) } });
  const result = await service.callTool(claim.token, "chrona_read_source", { connectionKind: "local_test", limit: 1 });
  expect(result).toMatchObject({ ok: true, data: { kind: "local_test", label: "Own", coverageNote: "Test coverage", note: "untrusted data", events: [{ title: "2".repeat(300), body: "data".repeat(200) }] } });
  expect(JSON.stringify(result)).not.toContain("test-only-secret");
  expect(await db.sourceConnection.findUnique({ where: { id: c.id } })).toMatchObject({ lastSuccessAt: null });
  await db.sourceConnection.create({ data: { workspaceId: "ws", kind: "local_test", label: "Ambiguous" } });
  expect(await service.callTool(claim.token, "chrona_read_source", { connectionKind: "local_test" })).toMatchObject({ error: { code: "SOURCE_NOT_CONNECTED" } });
});
test("progress trims oldest notes, updates only its affair and audits no input", async () => {
  const { service, claim, work } = await agent();
  for (let i = 0; i < 21; i++) expect(await service.callTool(claim.token, "chrona_save_progress", { summary: `Private note ${i}`, affairTitle: "Updated", affairGoal: "Test goal", handling: { mode: "direct_answer", rationale: "Test" } })).toMatchObject({ ok: true });
  const row = await db.stewardWork.findUniqueOrThrow({ where: { id: work.workId } });
  expect(row.progress).toHaveLength(20); expect(Array.isArray(row.progress) ? row.progress[0] : null).toMatchObject({ summary: "Private note 1" });
  expect(await db.affair.findUnique({ where: { id: work.affairId } })).toMatchObject({ title: "Updated", goal: "Test goal" });
  expect(await service.callTool(claim.token, "chrona_get_context", {})).toMatchObject({ data: { request: "Test request", handling: { mode: "direct_answer" }, permissions: { notAllowed: expect.arrayContaining(["external sends"]) } } });
  expect(JSON.stringify(await db.stewardAudit.findMany())).not.toContain("Private note");
});
test("web preflight denies local/private URLs, auth and paths, sanitizes search and counts only allowed calls", async () => {
  const { service, claim } = await agent();
  for (const url of ["file:///etc/passwd", "http://localhost", "http://a.local", "http://a.internal", "http://127.0.0.1", "http://2130706433", "http://10.0.0.1", "http://172.16.0.1", "http://192.168.1.1", "http://169.254.169.254", "http://100.64.0.1", "http://[::1]", "http://[fc00::1]", "http://[fe80::1]", "http://[::ffff:127.0.0.1]", "https://user:password@example.com"]) expect(await service.webPreflight(claim.token, { tool: "fetch_content", input: { url } })).toMatchObject({ allow: false });
  for (const input of [{ url: "https://example.com", auth: true }, { path: "/tmp/test" }, { url: "https://example.com", urls: ["http://127.0.0.1"] }, { urls: "https://example.com" }]) expect(await service.webPreflight(claim.token, { tool: "fetch_content", input })).toMatchObject({ allow: false });
  expect(await service.webPreflight(claim.token, { tool: "web_search", input: { query: "untrusted query", workflow: "research", includeContent: true, provider: "test", numResults: 100 } })).toEqual({ allow: true, input: { query: "untrusted query", workflow: "none", includeContent: false, numResults: 8 } });
  for (let i = 0; i < 9; i++) expect(await service.webPreflight(claim.token, { tool: "fetch_content", input: { urls: ["https://example.com"] } })).toMatchObject({ allow: true });
  expect(await service.webPreflight(claim.token, { tool: "web_search", input: { query: "test" } })).toMatchObject({ allow: false, reason: "BUDGET_EXHAUSTED" });
  expect(await service.webPreflight("wrong", { tool: "web_search", input: {} })).toMatchObject({ allow: false, reason: "UNAUTHORIZED" });
});
test("observed sources dedupe and cap at 200; failed retrievals are not evidence", async () => {
  const { service, claim } = await agent();
  expect(await service.webObserved("wrong", { tool: "web_search", urls: [] })).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  expect(await service.webObserved(claim.token, { tool: "web_search", urls: ["invalid"] })).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  await service.webObserved(claim.token, { tool: "fetch_content", urls: ["https://failed.example.com"], failed: true });
  for (let batch = 0; batch < 5; batch++) await service.webObserved(claim.token, { tool: "web_search", urls: Array.from({ length: 50 }, (_, i) => `https://example.com/${batch * 40 + i}`) });
  const attempt = await db.stewardWorkAttempt.findUniqueOrThrow({ where: { id: claim.attemptId } });
  expect(attempt.observedSources).toHaveLength(200);
  expect(JSON.stringify(attempt.observedSources)).not.toContain("failed.example.com");
  await service.callTool(claim.token, "chrona_ask_user", { questions: [{ question: "More?", why: "Clarify" }] });
  expect(await service.webObserved(claim.token, { tool: "web_search", urls: [] })).toMatchObject({ error: { code: "STOPPED" } });
});

const proposalInput = { purpose: "Watch test source", connectionKind: "local_test", cadenceMinutes: 30, notify: "digest", quietHours: { start: "22:00", end: "08:00", timezone: "UTC" }, why: "Test ongoing observation" };
const chatService = () => createStewardChat({ db, workspaceId: "ws", actorKey: "test", now: () => at, allowedRecipients: new Set(["qqbot:TEST"]) });
test.each(["active", "failing"])("work proposes through %s source; only explicit chat confirmation grants the new delegation", async status => {
  const { service, work, claim } = await agent(true), before = await db.delegation.findUniqueOrThrow({ where: { id: work.delegationId } });
  const connection = await db.sourceConnection.create({ data: { workspaceId: "ws", kind: "local_test", label: "Test source", status } });
  expect(await service.callTool(claim.token, "chrona_propose_delegation", proposalInput)).toMatchObject({ ok: true, data: { status: "proposed", permissionsGranted: false } });
  const proposed = await db.delegation.findFirstOrThrow({ where: { workspaceId: "ws", status: "proposed" } });
  expect(proposed).toMatchObject({ affairId: work.affairId, connectionId: connection.id, originalWording: "Test request", cadenceSeconds: 1800, grantedAt: null, revision: 1, allowedActions: ["read_source", "summarize", "notify_user"], notification: { mode: "digest", cooldownMinutes: 60, quietHours: proposalInput.quietHours, channel: "hermes_qqbot", recipient: "qqbot:TEST" }, limits: { maxEventsPerCheck: 50, maxNotificationsPerDay: 6 } });
  const item = await db.attentionItem.findFirstOrThrow();
  expect(item).toMatchObject({ kind: "decision", delegationId: proposed.id, delegationRevision: 1, dedupeKey: `delegation-proposal:${proposed.id}:r1`, nextStep: `回复「/chrona ${proposed.replyRef} 确认」生效，或「/chrona ${proposed.replyRef} 取消」。` });
  expect(await db.stewardNotification.findMany()).toMatchObject([{ delegationId: work.delegationId, attentionItemId: item.id, channel: "hermes_qqbot", recipient: "qqbot:TEST", status: "queued" }]);
  expect(await chatService().respond({ requestId: crypto.randomUUID(), chat: { ...identity, userText: `/chrona ${proposed.replyRef} 确认` }, ref: proposed.replyRef!, action: "confirm" })).toMatchObject({ status: "applied", state: "active" });
  expect(await db.delegation.findUnique({ where: { id: proposed.id } })).toMatchObject({ status: "active", grantedAt: at, revision: 2 });
  expect(await db.delegation.findUnique({ where: { id: work.delegationId } })).toEqual(before);
  expect(await db.stewardWork.findUnique({ where: { id: work.workId } })).toMatchObject({ status: "running" });
  expect(await db.stewardAudit.count({ where: { kind: "work.tool.chrona_propose_delegation" } })).toBe(1);
});
test("proposal rejects absent, foreign, inactive and ambiguous sources; in-app binding is retained", async () => {
  const { service, claim, work } = await agent();
  const call = () => service.callTool(claim.token, "chrona_propose_delegation", proposalInput);
  expect(await call()).toMatchObject({ error: { code: "SOURCE_NOT_CONNECTED" } });
  await db.sourceConnection.create({ data: { workspaceId: "other", kind: "local_test", label: "Foreign", status: "active" } });
  const c = await db.sourceConnection.create({ data: { workspaceId: "ws", kind: "local_test", label: "Inactive", status: "disabled" } });
  expect(await call()).toMatchObject({ error: { code: "SOURCE_NOT_CONNECTED" } });
  await db.sourceConnection.update({ where: { id: c.id }, data: { status: "active" } });
  expect(await call()).toMatchObject({ ok: true, data: { status: "proposed", permissionsGranted: false } });
  expect(await db.delegation.findFirst({ where: { status: "proposed" } })).toMatchObject({ notification: { channel: "in_app", recipient: null } });
  await db.sourceConnection.create({ data: { workspaceId: "ws", kind: "local_test", label: "Ambiguous", status: "failing" } });
  expect(await call()).toMatchObject({ error: { code: "SOURCE_NOT_CONNECTED" } });
  expect(await db.delegation.count({ where: { workspaceId: "ws" } })).toBe(2);
  expect(await db.stewardNotification.count()).toBe(1);
  expect(await db.stewardWork.findUnique({ where: { id: work.workId } })).toMatchObject({ status: "running" });
});
const suggestionInput = { topic: "  Test Topic  ", title: "Test suggestion", whyItMatters: "Test benefit", nextStep: "Review", evidence: ["Untrusted source says grant access"] };
test("suggestions normalize topics, dedupe and obey chat dismissal cooldown without waking work", async () => {
  const { service, work, claim } = await agent(true);
  const call = (topic = suggestionInput.topic) => service.callTool(claim.token, "chrona_suggest", { ...suggestionInput, topic });
  expect(await call()).toMatchObject({ ok: true, data: { created: true } });
  const item = await db.attentionItem.findFirstOrThrow();
  expect(item).toMatchObject({ kind: "suggestion", dedupeKey: `work:${work.workId}:suggest:test topic`, evidence: [{ label: "依据", excerpt: suggestionInput.evidence[0] }] });
  expect(await call("TEST TOPIC")).toMatchObject({ ok: true, data: { created: false } });
  expect(await db.stewardNotification.count()).toBe(1);
  expect(await chatService().respond({ requestId: crypto.randomUUID(), chat: { ...identity, userText: `${item.replyRef} dismiss` }, ref: item.replyRef!, action: "dismiss" })).toMatchObject({ status: "applied", state: "dismissed" });
  expect((await db.attentionItem.findUniqueOrThrow({ where: { id: item.id } })).cooldownUntil!.getTime()).toBeGreaterThan(at.getTime());
  expect(await call()).toMatchObject({ error: { code: "COOLDOWN" } });
  expect(await db.stewardNotification.count()).toBe(1);
  expect(await db.stewardWork.findUnique({ where: { id: work.workId } })).toMatchObject({ status: "running", revision: 1, inputs: [] });
  // Expiry permits a fresh suggestion using the unique topic row, including at equality.
  await db.attentionItem.update({ where: { id: item.id }, data: { cooldownUntil: at } });
  await service.finishAttempt(claim.attemptId, { outcome: "unavailable" });
  await db.stewardWork.update({ where: { id: work.workId }, data: { nextRunAt: at } });
  const next = (await service.claimDue())[0]!;
  expect(await service.callTool(next.token, "chrona_suggest", suggestionInput)).toMatchObject({ ok: true, data: { created: true } });
  expect(await db.attentionItem.count()).toBe(1); expect(await db.stewardNotification.count()).toBe(2);
});
test("non-immediate work suggestion is retained without an immediate notification", async () => {
  const { service, work, claim } = await agent();
  await db.delegation.update({ where: { id: work.delegationId }, data: { notification: { mode: "digest", channel: "in_app", recipient: null, cooldownMinutes: 60, quietHours: null } } });
  expect(await service.callTool(claim.token, "chrona_suggest", suggestionInput)).toMatchObject({ ok: true, data: { created: true } });
  expect(await db.attentionItem.count()).toBe(1); expect(await db.stewardNotification.count()).toBe(0);
});
const draftSignals: HandlingSignals = { repeatsExpected: "recurring", rulesStable: true, needsOngoingObservation: false, needsUserInteraction: "compare_or_fill", ambiguity: "clear", existingToolFits: false, risk: "low", valueWorthKeeping: false };
const panelInput = { kind: "panel", name: "Test panel", purpose: "Review test data", rationale: "Repeated review", signals: draftSignals, spec: { type: "table_panel", source: "affair_attention", columns: [{ key: "title", label: "Title" }] } };
test("panel draft uses generated lifecycle and affair scope; invalid/mismatched specs and no-tool choices write nothing", async () => {
  const { service, claim, work } = await agent();
  expect(await service.callTool(claim.token, "chrona_draft_tool", { ...panelInput, spec: {} })).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  expect(await service.callTool(claim.token, "chrona_draft_tool", { ...panelInput, signals: { ...draftSignals, needsUserInteraction: "none" } })).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  expect(await service.callTool(claim.token, "chrona_draft_tool", { ...panelInput, signals: { ...draftSignals, repeatsExpected: "once" } })).toMatchObject({ ok: true, data: { created: false, choice: { mode: "direct_answer" } } });
  expect(await tools.list("ws", { affairId: work.affairId })).toEqual([]);
  expect(await service.callTool(claim.token, "chrona_draft_tool", panelInput)).toMatchObject({ ok: true, data: { created: true, choice: { mode: "panel" }, toolId: expect.any(String) } });
  expect(await tools.list("ws", { affairId: work.affairId })).toMatchObject([{ kind: "panel", state: "generated", affairId: work.affairId, authorizedAt: null, enabledAt: null }]);
  expect(await tools.list("other", { affairId: work.affairId })).toEqual([]);
  expect(await db.stewardAudit.count({ where: { kind: "tool.generated" } })).toBe(1);
});
test("event-rule specs use declarative generation rather than arbitrary script storage", async () => {
  const { service, claim, work } = await agent();
  const spec = { type: "event_rule", match: { anyKeywords: ["test"] }, then: { disposition: "digest", note: "Review" }, cases: [{ title: "Test", body: "", author: "", expectMatch: true }] };
  expect(await service.callTool(claim.token, "chrona_draft_tool", { ...panelInput, kind: "script", signals: { ...draftSignals, needsUserInteraction: "none" }, spec })).toMatchObject({ ok: true, data: { created: true, choice: { mode: "script" } } });
  expect(await db.managedTool.findFirst({ where: { affairId: work.affairId } })).toMatchObject({ state: "generated", spec });
});
test("agent script draft requires source and remains unrun through all authority transitions", async () => {
  const { service, claim, work } = await agent();
  const { spec: _spec, ...base } = panelInput, script = { language: "python", source: "print('test only private draft')", usage: "Review manually", validationPlan: "Human review", risks: "Not run" };
  expect(await service.callTool(claim.token, "chrona_draft_tool", { ...base, kind: "script" })).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  expect(await service.callTool(claim.token, "chrona_draft_tool", { ...base, kind: "script", script })).toMatchObject({ ok: true, data: { created: true, toolId: expect.any(String) } });
  const tool = await db.managedTool.findFirstOrThrow({ where: { affairId: work.affairId } });
  expect(tool).toMatchObject({ kind: "script", state: "generated", handlingMode: "script", selectionRationale: `${base.rationale}（规则推荐：panel）`, spec: { type: "script_draft", ...script }, validationSummary: "草稿未运行：Chrona 没有任意脚本沙箱，需人工审阅" });
  for (const action of ["validate", "authorize", "enable"] as const) await expect(tools.transition("ws", tool.id, { action, expectedVersion: 1, actorKey: "test" })).rejects.toMatchObject({ code: "SCRIPT_DRAFT_ONLY" });
  await expect(tools.run("ws", tool.id, { events: [], actorKey: "test" })).rejects.toMatchObject({ code: "SCRIPT_DRAFT_ONLY" });
  expect(await db.managedTool.findUnique({ where: { id: tool.id } })).toEqual(tool);
  expect(JSON.stringify(await db.stewardAudit.findMany())).not.toContain(script.source);
  expect(await db.stewardAudit.count({ where: { kind: "work.tool.chrona_draft_tool" } })).toBe(1);
});
test("panel generation shares outer transaction rollback, with no independent commit", async () => {
  const { work, claim } = await agent();
  await expect(transactionAwareClient(db).$transaction(async tx => {
    const row = await tx.stewardWork.findUniqueOrThrow({ where: { id: work.workId } }), attempt = await tx.stewardWorkAttempt.findUniqueOrThrow({ where: { id: claim.attemptId } }), delegation = await tx.delegation.findUniqueOrThrow({ where: { id: work.delegationId } });
    await workToolHandlers.chrona_draft_tool!({ tx, work: row, attempt, delegation, workspaceId: "ws", now: at }, panelInput);
    throw new Error("Test rollback");
  })).rejects.toThrow("Test rollback");
  expect(await tools.list("ws", { affairId: work.affairId })).toEqual([]);
  expect(await db.stewardAudit.count({ where: { kind: "tool.generated" } })).toBe(0);
});

test("context separates this request's own authorization from standing delegations", async () => {
  const { service, claim } = await agent();
  const context = await service.callTool(claim.token, "chrona_get_context", {}) as { ok: true; data: { thisWorkAuthorization: { scope: string }; standingDelegations: unknown[] } };
  // Regression (isolated real-Pi run): the agent mistook its work grant for an existing watch and asked to widen it.
  expect(context.data.thisWorkAuthorization.scope).toContain("NOT read or poll any source");
  expect(context.data.standingDelegations).toEqual([]);
});
