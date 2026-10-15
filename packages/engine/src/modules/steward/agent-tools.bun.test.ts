import { afterEach, beforeEach, expect, test } from "bun:test";
import { testDb } from "./test-db";
import { createRuns } from "./runs";
import { createAgentTools } from "./agent-tools";
import { createAffairs } from "./affairs";
import { createAsks } from "./asks";
import { RUN_LIMITS, AFFAIR_TOOLS } from "@chrona/contracts/steward";
import { isPublicWebUrl } from "./web-url";
let db: ReturnType<typeof testDb>, now: Date, runs: ReturnType<typeof createRuns>, tools: ReturnType<typeof createAgentTools>, claim: NonNullable<Awaited<ReturnType<ReturnType<typeof createRuns>["claimNext"]>>>;
const handling = { mode: "result_page", rationale: "Needs evidence" };
beforeEach(async () => {
  db = testDb(); now = new Date("2026-10-20T02:00:00Z");
  await db.workspace.create({ data: { id: "w", name: "test" } });
  await createAffairs({ db, workspaceId: "w", now: () => now }).create({ request: "Research" });
  const ports = { db, now: () => now, chat: null, publicUrl: null };
  runs = createRuns(ports); tools = createAgentTools(ports); claim = (await runs.claimNext())!;
});
afterEach(async () => { await db.$disconnect(); });
test("catalog input schemas; progress and context omit tokens and limit history/results", async () => {
  expect(tools.catalog().find(t => t.name === "chrona_close")?.terminal).toBe(true);
  expect(tools.catalog()[0]!.inputSchema.type).toBe("object");
  const reply = await tools.callTool(claim.token, "chrona_save_progress", { summary: "Found evidence", findings: ["one"], nextStep: "Compare", handling });
  expect(reply.ok).toBe(true);
  for (let i = 0; i < 45; i++) await db.affairEntry.create({ data: { workspaceId: "w", affairId: claim.affairId, kind: "note", actor: "chrona", text: String(i), at: new Date(now.getTime() + i) } });
  await db.preference.create({ data: { workspaceId: "w", text: "Be concise", origin: "said" } });
  const context = await tools.callTool(claim.token, "chrona_get_context", {});
  expect(context.ok).toBe(true);
  if (!context.ok) return;
  const data = context.data as { entries: { text: string }[]; policy: unknown[]; remainingBudgets: { toolCalls: number } };
  expect(data.entries).toHaveLength(40);
  expect(data.entries.at(-1)?.text).toBe("44");
  expect(data.policy).toHaveLength(13);
  expect(data.remainingBudgets.toolCalls).toBe(38);
  expect(JSON.stringify(context)).not.toContain("tokenHash");
  expect(JSON.stringify(context)).not.toContain(claim.token);
  expect((await db.preference.findFirstOrThrow()).lastUsedAt).toEqual(now);
});
test("panel entries validate, normalize, scope and require an enabled approved panel", async () => {
  const drafted = await tools.callTool(claim.token, "chrona_draft_tool", { kind: "panel", name: "Weight", purpose: "Track weight", rationale: "Repeated values", spec: { title: "Weight", fields: [{ key: "kg", label: "Weight", type: "number", required: true }], views: [{ kind: "table", columns: ["kg"] }] } });
  expect(drafted.ok).toBe(true);
  const tool = await db.managedTool.findFirstOrThrow();
  const add = (values: unknown) => tools.callTool(claim.token, "chrona_add_panel_entry", { toolId: tool.id, values });
  expect(await add({ kg: "71.2" })).toMatchObject({ ok: true, data: { toolId: tool.id, values: { kg: 71.2 } } });
  expect(await add({ kg: "bad" })).toMatchObject({ ok: false, error: { code: "invalid", message: expect.stringContaining("kg") } });
  expect(await db.panelEntry.count()).toBe(1);
  const grant = await db.grant.create({ data: { workspaceId: "w", action: "write_chrona", mode: "never", scope: { kind: "affair", affairId: claim.affairId } } });
  expect(await add({ kg: 72 })).toMatchObject({ ok: false, error: { code: "never" } });
  await db.grant.update({ where: { id: grant.id }, data: { revokedAt: now } });
  expect(await db.panelEntry.count()).toBe(1);
  await db.managedTool.update({ where: { id: tool.id }, data: { state: "disabled" } });
  expect(await add({ kg: 72 })).toMatchObject({ ok: false, error: { code: "conflict" } });
  const other = await createAffairs({ db, workspaceId: "w", now: () => now }).create({ request: "Other" });
  await db.managedTool.update({ where: { id: tool.id }, data: { state: "enabled", affairId: other.id } });
  expect(await add({ kg: 72 })).toMatchObject({ ok: false, error: { code: "not_found" } });
  expect(await db.panelEntry.count()).toBe(1);
});
test("ask user is terminal once, resets failures, finish only stamps endedAt", async () => {
  await db.affair.update({ where: { id: claim.affairId }, data: { failures: 2 } });
  expect((await tools.callTool(claim.token, "chrona_ask_user", { questions: [{ question: "Which?", why: "Need scope" }], partialSummary: "Found options" })).ok).toBe(true);
  expect(await db.affair.findUnique({ where: { id: claim.affairId } })).toMatchObject({ agentState: "waiting_user", failures: 0 });
  expect(await tools.callTool(claim.token, "chrona_close", { outcome: "done", reason: "Done" })).toMatchObject({ ok: false, error: { code: "forbidden" } });
  await runs.finishRun(claim.runId, { outcome: "exited", note: "Exit" });
  expect(await db.affairRun.findUnique({ where: { id: claim.runId } })).toMatchObject({ status: "asked", endedAt: now });
  expect(await db.ask.count()).toBe(1);
  expect(await db.notification.count()).toBe(1);
});
test("approval never refuses without ending; auto allowed; ask blocks", async () => {
  expect(await tools.callTool(claim.token, "chrona_request_approval", { action: "change_credentials", what: "Change", why: "Needed" })).toMatchObject({ ok: false, error: { code: "never" } });
  expect(await tools.callTool(claim.token, "chrona_request_approval", { action: "read_source", what: "Read", why: "Needed" })).toEqual({ ok: true, data: { allowed: true } });
  expect((await tools.callTool(claim.token, "chrona_request_approval", { action: "purchase", what: "Buy", why: "Needed" })).ok).toBe(true);
  expect(await db.ask.findFirst()).toMatchObject({ action: "purchase", kind: "approval" });
  expect(await db.affairRun.findUnique({ where: { id: claim.runId } })).toMatchObject({ status: "asked" });
});
test("publish immutable versions with observed-only verification and watching preserved", async () => {
  await db.affair.update({ where: { id: claim.affairId }, data: { cadenceSeconds: 600 } });
  await db.affairRun.update({ where: { id: claim.runId }, data: { observedSources: ["https://example.com/seen"] } });
  const input = { title: "Report", summary: "Summary", body: "Full report", handling, nextSteps: ["Review"], sources: [{ title: "Seen", url: "https://example.com/seen" }, { title: "Unseen", url: "https://example.com/unseen" }] };
  expect((await tools.callTool(claim.token, "chrona_publish_result", input)).ok).toBe(true);
  const first = await db.affairResult.findFirstOrThrow();
  expect(first.sources).toMatchObject([{ verified: true }, { verified: false }]);
  expect(await db.affair.findUnique({ where: { id: claim.affairId } })).toMatchObject({ status: "watching", agentState: "idle", summary: "Summary", nextStep: "Review" });
  await createAffairs({ db, workspaceId: "w", now: () => now }).addEntry(claim.affairId, { kind: "feedback", text: "Revise" });
  claim = (await runs.claimNext())!;
  expect((await tools.callTool(claim.token, "chrona_publish_result", { ...input, body: "Revised" })).ok).toBe(true);
  expect(await db.affairResult.count()).toBe(2);
  expect(await db.affairResult.findUnique({ where: { id: first.id } })).toEqual(first);
});
for (const kind of ["feedback", "supplement"] as const) test(`one-off result finishes and ${kind} reopens for revision`, async () => {
  const affairs = createAffairs({ db, workspaceId: "w", now: () => now });
  const input = { title: "Report", summary: "Summary", body: "Report", handling, nextSteps: [], sources: [] };
  expect((await tools.callTool(claim.token, "chrona_publish_result", input)).ok).toBe(true);
  expect((await affairs.detail(claim.affairId)).affair).toMatchObject({ status: "done", agentState: "idle" });
  await runs.finishRun(claim.runId, { outcome: "exited", note: "" });
  expect(await runs.claimNext()).toBeNull();
  await affairs.addEntry(claim.affairId, { kind, text: "Revise" });
  expect((await affairs.detail(claim.affairId)).affair).toMatchObject({ status: "active", agentState: "queued" });
  claim = (await runs.claimNext())!;
  expect((await tools.callTool(claim.token, "chrona_publish_result", { ...input, body: "Revised" })).ok).toBe(true);
  expect(await db.affairResult.count()).toBe(2);
  expect((await affairs.detail(claim.affairId)).affair.status).toBe("done");
});
for (const outcome of ["done", "quiet", "continue_later"] as const) test(`close ${outcome} ends run`, async () => {
  expect((await tools.callTool(claim.token, "chrona_close", { outcome, reason: "Finished" })).ok).toBe(true);
  expect(await db.affair.findUnique({ where: { id: claim.affairId } })).toMatchObject({ status: outcome === "done" ? "done" : "active", agentState: "idle" });
  expect(await runs.shouldStop(claim.runId)).toBe(true);
});
test("invalid and unsupported calls counted; budget enforced; paused tools forbidden", async () => {
  expect(await tools.callTool(claim.token, "chrona_close", { outcome: "bogus" })).toMatchObject({ ok: false, error: { code: "invalid" } });
  expect(await tools.callTool(claim.token, "unsupported_tool", {})).toMatchObject({ ok: false, error: { code: "not_available" } });
  for (let i = 2; i < RUN_LIMITS.maxToolCalls; i++) await tools.callTool(claim.token, "chrona_close", {});
  expect(await tools.callTool(claim.token, "chrona_get_context", {})).toMatchObject({ ok: false, error: { code: "budget_exhausted" } });
  await db.affair.update({ where: { id: claim.affairId }, data: { status: "paused" } });
  expect(await tools.callTool(claim.token, "chrona_get_context", {})).toMatchObject({ ok: false, error: { code: "forbidden" } });
});
test("write policy never refuses, ask creates approval, notify_after folds notification and consumes once", async () => {
  const grant = await db.grant.create({ data: { workspaceId: "w", action: "write_chrona", mode: "never", scope: { kind: "affair", affairId: claim.affairId } } });
  expect(await tools.callTool(claim.token, "chrona_save_progress", { summary: "Blocked" })).toMatchObject({ ok: false, error: { code: "never" } });
  expect((await db.affair.findUniqueOrThrow({ where: { id: claim.affairId } })).summary).toBe("");
  await db.grant.update({ where: { id: grant.id }, data: { mode: "notify_after", once: true } });
  expect((await tools.callTool(claim.token, "chrona_save_progress", { summary: "Allowed" })).ok).toBe(true);
  expect(await db.notification.findFirst()).toMatchObject({ level: "digest", status: "folded" });
  expect((await db.grant.findUniqueOrThrow({ where: { id: grant.id } })).consumedAt).toEqual(now);
  await db.grant.update({ where: { id: grant.id }, data: { mode: "ask", once: false } });
  expect((await tools.callTool(claim.token, "chrona_save_progress", { summary: "Needs approval" })).ok).toBe(true);
  expect((await db.affair.findUniqueOrThrow({ where: { id: claim.affairId } })).summary).toBe("Allowed");
  expect(await db.ask.findFirst()).toMatchObject({ kind: "approval", action: "write_chrona" });
  expect(await runs.shouldStop(claim.runId)).toBe(true);
});
test("all contract tools are advertised", () => {
  expect(tools.catalog().map(t => t.name).sort()).toEqual([...AFFAIR_TOOLS].sort());
});
test("care sets watching, next check, connection and digest notification", async () => {
  const connection = await db.sourceConnection.create({ data: { workspaceId: "w", kind: "local_test", label: "Test", mode: "poll" } });
  expect((await tools.callTool(claim.token, "chrona_set_care", { cadenceMinutes: 15, connectionKind: "local_test", why: "Watch changes" })).ok).toBe(true);
  expect(await db.affair.findUnique({ where: { id: claim.affairId } })).toMatchObject({ status: "watching", cadenceSeconds: 900, connectionId: connection.id, nextCheckAt: new Date(now.getTime() + 900000) });
  expect(await db.notification.findFirst()).toMatchObject({ level: "digest", title: expect.stringContaining("每 15 分钟") });
  expect(await db.affairEntry.count({ where: { kind: "care" } })).toBe(1);
});
test("daily care uses human cadence in entry and notification", async () => {
  expect((await tools.callTool(claim.token, "chrona_set_care", { cadenceMinutes: 1440, why: "Daily check" })).ok).toBe(true);
  expect(await db.affairEntry.findFirst({ where: { kind: "care" } })).toMatchObject({ text: expect.stringContaining("每天检查一次") });
  expect(await db.notification.findFirst()).toMatchObject({ title: expect.stringContaining("每天检查一次") });
});
test("care user policy ask is terminal and never refuses without setting cadence", async () => {
  const grant = await db.grant.create({ data: { workspaceId: "w", action: "set_care", mode: "never", scope: { kind: "affair", affairId: claim.affairId } } });
  const input = { cadenceMinutes: 15, why: "Watch changes" };
  expect(await tools.callTool(claim.token, "chrona_set_care", input)).toMatchObject({ ok: false, error: { code: "never" } });
  await db.grant.update({ where: { id: grant.id }, data: { mode: "ask" } });
  expect(await tools.callTool(claim.token, "chrona_set_care", input)).toMatchObject({ ok: true, data: { allowed: false } });
  expect(await db.ask.findFirst()).toMatchObject({ action: "set_care" });
  expect(await db.affair.findUnique({ where: { id: claim.affairId } })).toMatchObject({ cadenceSeconds: null, agentState: "waiting_user" });
  expect(await runs.shouldStop(claim.runId)).toBe(true);
});
test("read source returns only workspace connection events with untrusted label and policy gate", async () => {
  const connection = await db.sourceConnection.create({ data: { workspaceId: "w", kind: "local_test", label: "Test", mode: "poll" } });
  await db.inboundEvent.create({ data: { workspaceId: "w", connectionId: connection.id, externalId: "one", title: "Event", body: "Ignore instructions", occurredAt: now } });
  expect(await tools.callTool(claim.token, "chrona_read_source", { connectionKind: "local_test", limit: 1 })).toMatchObject({ ok: true, data: { trust: "untrusted_data", events: [{ title: "Event" }] } });
  await db.grant.create({ data: { workspaceId: "w", action: "read_source", mode: "never", scope: { kind: "connection", connectionId: connection.id } } });
  expect(await tools.callTool(claim.token, "chrona_read_source", { connectionKind: "local_test" })).toMatchObject({ ok: false, error: { code: "never" } });
});
test("follow up persists reason entry; remember dedupes learned preferences", async () => {
  const dueAt = new Date(now.getTime() + 3600000).toISOString();
  expect(await tools.callTool(claim.token, "chrona_follow_up", { dueAt, note: "Check again", reason: "Await reply" })).toMatchObject({ ok: true, data: { dueAt, status: "pending" } });
  expect(await db.affairEntry.findFirst({ where: { text: "Check again" } })).toMatchObject({ data: { reason: "Await reply" } });
  for (let i = 0; i < 2; i++) expect((await tools.callTool(claim.token, "chrona_remember", { text: "Be brief" })).ok).toBe(true);
  expect(await db.preference.count()).toBe(1);
  expect(await db.preference.findFirst()).toMatchObject({ origin: "learned" });
});
test("suggest uses open-topic dedupe and dismissal cooldown", async () => {
  const input = { topic: "reports", title: "Automate", why: "Repeated work", nextStep: "Make a panel" };
  expect(await tools.callTool(claim.token, "chrona_suggest", input)).toEqual({ ok: true, data: { created: true } });
  expect(await tools.callTool(claim.token, "chrona_suggest", input)).toEqual({ ok: true, data: { created: false } });
  const ask = await db.ask.findFirstOrThrow();
  await createAsks({ db, workspaceId: "w", now: () => now }).resolve(ask.id, { decision: "dismiss" });
  expect(await tools.callTool(claim.token, "chrona_suggest", input)).toEqual({ ok: true, data: { created: false } });
});
test("notify cap is three successful notifications per run", async () => {
  const input = { level: "now", title: "Update", body: "Changed", why: "Useful" };
  for (let i = 0; i < 3; i++) expect((await tools.callTool(claim.token, "chrona_notify", input)).ok).toBe(true);
  expect(await tools.callTool(claim.token, "chrona_notify", input)).toMatchObject({ ok: false, error: { code: "budget_exhausted" } });
  expect(await db.notification.count()).toBe(3);
  expect(await db.affairEntry.count({ where: { kind: "notification" } })).toBe(3);
});
const panel = { kind: "panel", name: "Tracker", purpose: "Track entries", rationale: "Recurring", spec: { title: "Tracker", fields: [{ key: "name", label: "Name", type: "text" }], views: [{ kind: "table", columns: ["name"] }] } };
test("draft valid panel enables via policy, invalid panel stays validation_failed; panels not runnable", async () => {
  expect(await tools.callTool(claim.token, "chrona_draft_tool", panel)).toMatchObject({ ok: true, data: { state: "enabled" } });
  const tool = await db.managedTool.findFirstOrThrow();
  expect(await db.notification.findFirst()).toMatchObject({ level: "digest" });
  expect(await tools.callTool(claim.token, "chrona_run_tool", { toolId: tool.id })).toMatchObject({ ok: false, error: { code: "not_runnable" } });
  expect(await tools.callTool(claim.token, "chrona_draft_tool", { ...panel, spec: {} })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
  expect(await db.managedTool.count({ where: { state: "validation_failed" } })).toBe(1);
  await db.grant.create({ data: { workspaceId: "w", action: "enable_panel", mode: "ask", scope: { kind: "affair", affairId: claim.affairId } } });
  expect(await tools.callTool(claim.token, "chrona_draft_tool", panel)).toMatchObject({ ok: true, data: { state: "draft" } });
  expect(await db.ask.findFirst()).toMatchObject({ action: "enable_panel" });
});
test("draft script creates version-scoped approval; run before/after approval honest and grant unconsumed", async () => {
  expect(await tools.callTool(claim.token, "chrona_draft_tool", { kind: "script", name: "Report", purpose: "Report", rationale: "Repeat", script: { language: "python", source: "print(1)", usage: "Run" } })).toMatchObject({ ok: true, data: { state: "draft" } });
  const tool = await db.managedTool.findFirstOrThrow(), ask = await db.ask.findFirstOrThrow();
  expect(ask.actionPayload).toEqual({ toolId: tool.id, version: 1 });
  expect(await runs.shouldStop(claim.runId)).toBe(false);
  expect(await tools.callTool(claim.token, "chrona_run_tool", { toolId: tool.id })).toMatchObject({ ok: false, error: { code: "ask" } });
  expect(await db.ask.count()).toBe(1);
  await createAsks({ db, workspaceId: "w", now: () => now }).resolve(ask.id, { decision: "approve" });
  expect(await tools.callTool(claim.token, "chrona_run_tool", { toolId: tool.id })).toMatchObject({ ok: false, error: { code: "unavailable", message: "沙箱不可用" } });
  expect(await db.grant.findFirst()).toMatchObject({ scope: { kind: "tool_version", toolId: tool.id, version: 1 }, consumedAt: null });
  expect(await db.toolRun.findFirst()).toMatchObject({ status: "unavailable", output: "" });
});
test("script execution persists exact version and consumes once approval; changed version cannot run", async () => {
  await tools.callTool(claim.token, "chrona_draft_tool", { kind: "script", name: "Report", purpose: "Report", rationale: "Repeat", script: { language: "python", source: "print(1)", usage: "Run" } });
  const tool = await db.managedTool.findFirstOrThrow(), ask = await db.ask.findFirstOrThrow();
  await createAsks({ db, workspaceId: "w", now: () => now }).resolve(ask.id, { decision: "approve" });
  let calls = 0;
  tools = createAgentTools({ db, now: () => now, chat: null, publicUrl: null, sandbox: { health: { available: true, languages: ["python"] }, async run(input) { calls++; expect(input.source).toBe("print(1)"); expect(await db.toolRun.findFirst()).toMatchObject({ status: "running" }); return { status: "succeeded", output: "1\n", error: null }; } } });
  expect(await tools.callTool(claim.token, "chrona_run_tool", { toolId: tool.id })).toMatchObject({ ok: true, data: { version: 1, status: "succeeded", output: "1\n" } });
  expect(await db.toolRun.findFirst()).toMatchObject({ status: "succeeded", endedAt: now });
  expect(await db.grant.findFirst({ where: { action: "run_script" } })).toMatchObject({ once: true, consumedAt: now });
  expect(await db.affairEntry.findFirst({ where: { text: { contains: "运行了脚本" } } })).toMatchObject({ text: "运行了脚本「Report」v1：成功" });
  await db.toolVersion.create({ data: { workspaceId: "w", toolId: tool.id, version: 2, contentHash: "changed", script: { language: "python", source: "print(2)", usage: "Run" } } });
  await db.managedTool.update({ where: { id: tool.id }, data: { version: 2 } });
  expect(await tools.callTool(claim.token, "chrona_run_tool", { toolId: tool.id })).toMatchObject({ ok: false, error: { code: "ask" } });
  expect(calls).toBe(1);
});
test.each(["failed", "timed_out"] as const)("script %s outcome and bounded output persist without pretending success", async status => {
  await tools.callTool(claim.token, "chrona_draft_tool", { kind: "script", name: "Report", purpose: "Report", rationale: "Repeat", script: { language: "python", source: "print(1)", usage: "Run" } });
  const tool = await db.managedTool.findFirstOrThrow(), ask = await db.ask.findFirstOrThrow();
  await createAsks({ db, workspaceId: "w", now: () => now }).resolve(ask.id, { decision: "approve" });
  tools = createAgentTools({ db, now: () => now, chat: null, publicUrl: null, sandbox: { health: { available: true, languages: ["python"] }, async run() { return { status, output: "x".repeat(25000), error: "failed" }; } } });
  expect(await tools.callTool(claim.token, "chrona_run_tool", { toolId: tool.id })).toMatchObject({ ok: true, data: { status, output: "x".repeat(20000), error: "failed" } });
  expect(await db.managedTool.findFirst()).toMatchObject({ lastRunOk: false });
});
const blockedUrls = ["http://localhost", "http://localhost.", "http://a.localhost", "http://127.1", "http://127.2.3.4", "http://0x7f000001", "http://10.2.3.4", "http://172.16.0.1", "http://172.31.255.255", "http://192.168.1.2", "http://169.254.1.2", "http://[::1]", "http://[fc00::1]", "http://[fdff::1]", "http://[fe80::1]", "http://[::ffff:127.0.0.1]", "file:///tmp/test", "ftp://example.com", "https://user:pass@example.com", "not a url"];
test("web preflight rejects private URL table, validates every batch target and enforces budget", async () => {
  for (const url of blockedUrls) {
    expect(isPublicWebUrl(url)).toBe(false);
    expect(await tools.webPreflight(claim.token, { tool: "fetch_content", input: { url } })).toMatchObject({ allow: false });
  }
  expect(await tools.webPreflight(claim.token, { tool: "fetch_content", input: { urls: ["https://example.com", "http://localhost"] } })).toMatchObject({ allow: false });
  expect(await tools.webPreflight(claim.token, { tool: "fetch_content", input: {} })).toMatchObject({ allow: false });
  for (const url of ["https://example.com", "http://8.8.8.8", "http://172.15.0.1", "http://172.32.0.1", "https://[2606:4700::1111]"]) expect(isPublicWebUrl(url)).toBe(true);
  for (let i = 0; i < RUN_LIMITS.maxWebCalls; i++) expect(await tools.webPreflight(claim.token, { tool: "fetch_content", input: { url: "https://example.com" } })).toMatchObject({ allow: true });
  expect(await tools.webPreflight(claim.token, { tool: "web_search", input: { query: "test" } })).toMatchObject({ allow: false, reason: "budget_exhausted" });
  expect((await db.affairRun.findUniqueOrThrow({ where: { id: claim.runId } })).webCalls).toBe(RUN_LIMITS.maxWebCalls);
});
test("web policy refuses; observed URLs dedupe, cap and verify published sources", async () => {
  await db.grant.create({ data: { workspaceId: "w", action: "web_research", mode: "never", scope: { kind: "affair", affairId: claim.affairId } } });
  expect(await tools.webPreflight(claim.token, { tool: "web_search", input: { query: "test" } })).toMatchObject({ allow: false });
  expect(await tools.webObserved(claim.token, { tool: "fetch_content", urls: ["https://example.com/seen", "https://example.com/seen", "http://localhost"] })).toMatchObject({ ok: true, data: { observed: 1 } });
  await tools.webObserved(claim.token, { tool: "fetch_content", urls: ["https://example.com/failed"], failed: true });
  for (let i = 0; i < 5; i++) await tools.webObserved(claim.token, { tool: "web_search", urls: Array.from({ length: 50 }, (_, j) => `https://example.com/${i * 50 + j}`) });
  expect((await db.affairRun.findUniqueOrThrow({ where: { id: claim.runId } })).observedSources).toHaveLength(200);
  expect((await tools.callTool(claim.token, "chrona_publish_result", { title: "Report", summary: "Summary", body: "Report", handling, sources: [{ title: "Seen", url: "https://example.com/seen" }, { title: "Failed", url: "https://example.com/failed" }] })).ok).toBe(true);
  expect((await db.affairResult.findFirstOrThrow()).sources).toMatchObject([{ verified: true }, { verified: false }]);
  expect(await tools.webObserved(claim.token, { tool: "web_search", urls: [] })).toMatchObject({ ok: false, error: { code: "forbidden" } });
});
test("script approvals grant only the exact tool version, once or persistent; normal approval affair-scoped", async () => {
  const tool = await db.managedTool.create({ data: { workspaceId: "w", affairId: claim.affairId, kind: "script", name: "Test", purpose: "Test" } });
  await db.toolVersion.create({ data: { workspaceId: "w", toolId: tool.id, version: 1, contentHash: "test" } });
  const asks = createAsks({ db, workspaceId: "w", now: () => now });
  for (const scope of ["once", "affair"] as const) {
    const ask = await asks.createApproval({ affairId: claim.affairId, title: "Run exact script", action: "run_script", actionPayload: { toolId: tool.id, version: 1 } });
    await asks.resolve(ask.id, { decision: "approve", scope });
    const grant = await db.grant.findFirstOrThrow({ where: { action: "run_script", once: scope === "once" } });
    expect(grant.scope).toEqual({ kind: "tool_version", toolId: tool.id, version: 1 });
  }
  const ask = await asks.createApproval({ affairId: claim.affairId, title: "Buy", action: "purchase" });
  await asks.resolve(ask.id, { decision: "approve" });
  expect((await db.grant.findFirstOrThrow({ where: { action: "purchase" } })).scope).toEqual({ kind: "affair", affairId: claim.affairId });
});
