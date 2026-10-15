import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { createChinoServiceHealthSource, createLocalTestSource, createRedditInboxSource, createRuleAssessor } from "@chrona/integrations/steward";
import { createStewardService } from "./index";
import { assessmentAuthority, recordAssessmentEffects } from "./process-effects";
import { raiseDigests } from "./digest";
import { raiseSuggestions } from "./suggest";
import type { Context } from "./mappers";
import { createStewardWork } from "./work";
import { createStewardChat, ensureRef } from "./chat";
import { WORK_LIMITS } from "@chrona/contracts/steward";

let db: PrismaClient, directory: string, ctx: Context, polls: number;
const at = new Date("2031-01-20T12:00:00Z");
beforeEach(async () => {
  directory = mkdtempSync(join(import.meta.dir, ".work-test-")); const url = `file:${join(directory, "test.sqlite")}`;
  ensureSqliteDatabase({ databaseUrl: url, migrationsDir: resolve("prisma/migrations") });
  db = new PrismaClient({ adapter: new PrismaBunSqlite({ url }) });
  await db.workspace.createMany({ data: ["ws", "other"].map(id => ({ id, name: "Test only", status: "Active" })) });
  await db.affair.create({ data: { id: "affair", workspaceId: "ws", title: "Test work" } });
  await db.delegation.create({ data: { id: "work-grant", workspaceId: "ws", affairId: "affair", purpose: "Test work only", status: "active", grantedAt: at, allowedActions: ["read_source", "notify_user", "summarize"], notification: { mode: "digest", channel: "in_app", cooldownMinutes: 0, quietHours: null, recipient: null } } });
  await db.stewardWork.create({ data: { id: "work", workspaceId: "ws", affairId: "affair", delegationId: "work-grant", request: "Test only", nextRunAt: at } });
  polls = 0;
  const actor = { workspaceId: "ws", actorKey: "test:owner", canWrite: true }, source = createLocalTestSource().adapter;
  ctx = { db, actor, authorize: async () => actor, now: () => at,
    sources: { local_test: { ...source, poll: async (...args) => { polls++; return source.poll(...args); } }, reddit_inbox: createRedditInboxSource({}), chino_service_health: createChinoServiceHealthSource() },
    assessor: createRuleAssessor({ available: () => true }), deliveryAdapters: {} };
});
afterEach(async () => { await db?.$disconnect(); if (directory) rmSync(directory, { recursive: true, force: true }); });

test("active work delegation cannot authorize source-event notifications or automatic polling, even with read_source", async () => {
  const service = createStewardService(ctx);
  const connection = await service.connections.create({ kind: "local_test", label: "Test only" });
  const event = await db.inboundEvent.create({ data: { workspaceId: "ws", connectionId: connection.id, externalId: "test", affairId: "affair", linkStatus: "confirmed", title: "Test event", body: "Test data", author: "Test", occurredAt: at } });
  await db.$transaction(async tx => {
    const delegation = await assessmentAuthority(tx, event, "affair", at);
    expect(delegation).toBeUndefined();
    await recordAssessmentEffects(tx, { workspaceId: "ws", actorKey: "test:owner", now: at, event, linked: "affair", delegation, assessorName: "test-only", proposal: { disposition: "notify_now", whatHappened: "Test", whyItMatters: "Test", nextStep: "Review", proposedAction: "notify_user", affairId: "affair", followUp: null } });
    await tx.inboundEvent.update({ where: { id: event.id }, data: { status: "assessed" } });
  });
  expect(await db.stewardNotification.count()).toBe(0);
  expect(await service.tick()).toMatchObject({ synced: 0 });
  expect(polls).toBe(0);
  expect(await db.delegation.findUnique({ where: { id: "work-grant" } })).toMatchObject({ lastCheckAt: null });
  // Ordinary standing authority remains usable; work scope is not a blanket deny.
  await db.delegation.create({ data: { id: "standing", workspaceId: "ws", purpose: "Test standing authority", status: "active", allowedActions: ["read_source", "notify_user"] } });
  expect((await db.$transaction(tx => assessmentAuthority(tx, event, "affair", at)))?.id).toBe("standing");
  expect(await service.tick()).toMatchObject({ synced: 1 });
  expect(polls).toBe(1);
});

test("work delegations never produce source digests; ordinary delegations still do", async () => {
  await db.delegation.create({ data: { id: "standing", workspaceId: "ws", purpose: "Test standing authority", status: "active", allowedActions: ["notify_user"], notification: { mode: "digest", channel: "in_app", cooldownMinutes: 0, quietHours: null, recipient: null } } });
  for (const delegationId of ["work-grant", "standing"]) await db.attentionItem.create({ data: { workspaceId: "ws", affairId: "affair", delegationId, dedupeKey: delegationId, kind: "change", title: "Test", whatHappened: "Test", whyItMatters: "Test", nextStep: "Review", createdAt: at } });
  await raiseDigests(ctx); await raiseDigests(ctx);
  expect(await db.stewardNotification.findMany({ select: { delegationId: true } })).toEqual([{ delegationId: "standing" }]);
});

test("suggestion coverage excludes work delegations without hiding ordinary standing delegations", async () => {
  await db.affair.update({ where: { id: "affair" }, data: { status: "paused" } });
  expect(await raiseSuggestions(ctx)).toMatchObject({ raised: 0 });
  await db.delegation.create({ data: { id: "standing", workspaceId: "ws", affairId: "affair", purpose: "Test standing authority", status: "active" } });
  expect(await raiseSuggestions(ctx)).toMatchObject({ raised: 1 });
  const item = await db.attentionItem.findFirstOrThrow({ where: { kind: "suggestion" } });
  expect(decodeURIComponent(item.dedupeKey)).toContain("delegation:standing");
  expect(decodeURIComponent(item.dedupeKey)).not.toContain("delegation:work-grant");
});

const allowedRecipients = new Set(["qqbot:TEST", "qqbot:OTHER"]);
const identity = { route: "chrona_command" as const, platform: "qqbot" as const, chatType: "dm" as const, userId: "TEST", chatId: "TEST", messageId: "m", userText: "Test work" };
const core = (clock = () => at, workspaceId?: string) => createStewardWork({ db, now: clock, allowedRecipients, workspaceId });
const chatService = () => createStewardChat({ db, workspaceId: "ws", actorKey: "test", now: () => at, allowedRecipients });
const response = (ref: string, action: "feedback" | "pause" | "resume" | "revoke", note?: string) => chatService().respond({ requestId: crypto.randomUUID(), chat: { ...identity, userText: `${ref} ${action}` }, ref, action, note });
async function onlyNewWork(clock = () => at) {
  await db.stewardWork.update({ where: { id: "work" }, data: { nextRunAt: null } });
  const service = core(clock), created = await service.create({ workspaceId: "ws", text: "Test request\nsecond line", chat: { identity, recipient: "qqbot:TEST" } });
  return { service, created, claim: (await service.claimDue())[0]! };
}
test("create is atomic, scoped, hashed; claim once and owner views omit capabilities", async () => {
  const { service, created, claim } = await onlyNewWork();
  expect(claim.token).toHaveLength(43); expect(await service.claimDue()).toEqual([]);
  expect(await db.affair.findUnique({ where: { id: created.affairId } })).toMatchObject({ title: "Test request" });
  expect(await db.delegation.findUnique({ where: { id: created.delegationId } })).toMatchObject({ status: "active", revision: 1, connectionId: null, cadenceSeconds: null });
  expect(JSON.stringify(await db.stewardWorkAttempt.findMany())).not.toContain(claim.token);
  expect(JSON.stringify(await db.stewardAudit.findMany())).not.toContain("Test request");
  const owner = createStewardService(ctx), view = await owner.works.detail(created.workId);
  expect(view).toMatchObject({ status: "running", replyRef: created.ref, attempts: [{ number: 1 }] });
  expect(JSON.stringify(view)).not.toContain("tokenHash");
  expect((await owner.affairs.detail(created.affairId)).works).toHaveLength(1);
  expect((await owner.delegations.list()).find(d => d.id === created.delegationId)?.workId).toBe(created.workId);
  await expect(createStewardService({ ...ctx, authorize: async () => ({ workspaceId: "other", actorKey: "test", canWrite: true }) }).works.detail(created.workId)).rejects.toMatchObject({ code: "NOT_FOUND" });
});
test("tool envelope rejects invalid, unknown and out-of-scope calls; ask stops tools", async () => {
  const { service, claim, created } = await onlyNewWork();
  expect(await service.callTool("wrong", "chrona_get_context", {})).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
  expect(await core(() => at, "other").callTool(claim.token, "chrona_get_context", {})).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
  expect(await service.callTool(claim.token, "chrona_get_context", { workspaceId: "other" })).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  expect(await service.callTool(claim.token, "toString", {})).toMatchObject({ error: { code: "UNKNOWN_TOOL" } });
  expect(await service.callTool(claim.token, "chrona_close_quietly", { reason: "No need to disturb" })).toMatchObject({ error: { code: "NOT_ALLOWED" } });
  expect(await service.callTool(claim.token, "chrona_ask_user", { questions: [{ question: "test", why: "test" }] })).toMatchObject({ ok: true });
  expect(await service.callTool(claim.token, "chrona_get_context", {})).toMatchObject({ error: { code: "STOPPED" } });
  await service.finishAttempt(claim.attemptId, { outcome: "exited" }); await service.finishAttempt(claim.attemptId, { outcome: "exited" });
  expect(await db.stewardWorkAttempt.findUnique({ where: { id: claim.attemptId } })).toMatchObject({ status: "asked_user", endedAt: at });
  expect(await db.stewardWork.findUnique({ where: { id: created.workId } })).toMatchObject({ failures: 0 });
  expect(await db.stewardNotification.count()).toBe(1);
});
test("budget ends attempt and rejects future calls; deadline rejects token", async () => {
  let clock = at; const { service, claim, created } = await onlyNewWork(() => clock);
  for (let i = 0; i < WORK_LIMITS.maxToolCalls; i++) expect((await service.callTool(claim.token, "unknown", {})).ok).toBe(false);
  expect(await service.callTool(claim.token, "chrona_get_context", {})).toMatchObject({ error: { code: "BUDGET_EXHAUSTED" } });
  expect(await db.stewardWork.findUnique({ where: { id: created.workId } })).toMatchObject({ failures: 1, status: "received" });
  clock = new Date(at.getTime() + 60_000); const second = (await service.claimDue())[0]!;
  clock = second.deadlineAt; expect(await service.shouldStop(second.attemptId)).toBe(true);
  expect(await service.callTool(second.token, "chrona_get_context", {})).toMatchObject({ error: { code: "UNAUTHORIZED" } });
});
test("pause stops running work; resume runs again; revoke cancels", async () => {
  const { service, claim, created } = await onlyNewWork();
  expect(await response(created.ref, "pause")).toMatchObject({ state: "paused" });
  expect(await service.shouldStop(claim.attemptId)).toBe(true);
  expect(await service.callTool(claim.token, "chrona_get_context", {})).toMatchObject({ error: { code: "STOPPED" } });
  await service.finishAttempt(claim.attemptId, { outcome: "killed" });
  expect(await db.stewardWorkAttempt.findUnique({ where: { id: claim.attemptId } })).toMatchObject({ status: "cancelled" });
  expect(await service.claimDue()).toEqual([]);
  await response(created.ref, "resume"); const second = (await service.claimDue())[0]!; expect(second).toBeDefined();
  await response(created.ref, "revoke"); expect(await service.shouldStop(second.attemptId)).toBe(true);
  await service.finishAttempt(second.attemptId, { outcome: "killed" });
  expect(await db.stewardWork.findUnique({ where: { id: created.workId } })).toMatchObject({ status: "cancelled", failures: 0 });
  expect(await service.claimDue()).toEqual([]);
});
test("three failures raise one failure item and queued notification; unavailable is not failure", async () => {
  let clock = at; const { service, claim, created } = await onlyNewWork(() => clock);
  await service.finishAttempt(claim.attemptId, { outcome: "unavailable", note: "never persist raw runner text" });
  expect(await db.stewardWork.findUnique({ where: { id: created.workId } })).toMatchObject({ failures: 0, nextRunAt: new Date(at.getTime() + 300_000) });
  for (let i = 0; i < 3; i++) { clock = new Date(clock.getTime() + 900_000); const next = (await service.claimDue())[0]!; await service.finishAttempt(next.attemptId, { outcome: "exited" }); await service.finishAttempt(next.attemptId, { outcome: "exited" }); }
  expect(await db.stewardWork.findUnique({ where: { id: created.workId } })).toMatchObject({ failures: 3, status: "failed" });
  expect(await db.attentionItem.count({ where: { kind: "failure" } })).toBe(1);
  expect(await db.stewardNotification.findFirst()).toMatchObject({ status: "queued", delegationId: created.delegationId });
});
test("lease recovery (Chrona restart) retries without counting an agent failure, and tick invokes recovery", async () => {
  let clock = at; const { service, claim, created } = await onlyNewWork(() => clock);
  clock = new Date(claim.deadlineAt.getTime() + 60_001);
  await createStewardService({ ...ctx, now: () => clock }).tick();
  expect(await db.stewardWorkAttempt.findUnique({ where: { id: claim.attemptId } })).toMatchObject({ status: "lease_expired" });
  expect(await service.recover()).toEqual({ recovered: 0 });
  expect(await db.stewardWork.findUnique({ where: { id: created.workId } })).toMatchObject({ failures: 0, status: "received" });
});
test.each(["close", "exit"])("chat request and concurrent feedback are scoped and visible after %s", async ending => {
  await db.stewardWork.update({ where: { id: "work" }, data: { nextRunAt: null } });
  const requested = await chatService().request({ requestId: crypto.randomUUID(), chat: identity, text: "Any natural language" });
  const service = core(), first = (await service.claimDue())[0]!;
  expect((await chatService().pending({ chat: identity })).works).toEqual([{ ref: requested.ref, status: "running", request: "Any natural language" }]);
  expect(await chatService().respond({ requestId: crypto.randomUUID(), chat: { ...identity, chatId: "OTHER", userId: "OTHER", userText: `${requested.ref} feedback` }, ref: requested.ref, action: "feedback", note: "No" })).toMatchObject({ status: "not_permitted" });
  await response(requested.ref, "feedback", "New information");
  expect(await service.claimDue()).toEqual([]); // User wake must not overlap a still-live attempt.
  if (ending === "close") expect(await service.callTool(first.token, "chrona_ask_user", { questions: [{ question: "More?", why: "Clarify" }] })).toMatchObject({ ok: true });
  await service.finishAttempt(first.attemptId, { outcome: "exited" });
  const second = (await service.claimDue())[0]!;
  expect(await service.callTool(second.token, "chrona_get_context", {})).toMatchObject({ ok: true, data: { wakeReason: "user_input", inputs: [{ kind: "feedback", text: "New information" }] } });
});
test("stale question refs conflict; answer resolves question and authorization/result decisions stay separate", async () => {
  const { service, claim, created } = await onlyNewWork();
  await service.finishAttempt(claim.attemptId, { outcome: "unavailable" });
  await db.stewardWork.update({ where: { id: created.workId }, data: { status: "waiting_input" } });
  const item = await db.attentionItem.create({ data: { workspaceId: "ws", affairId: created.affairId, delegationId: created.delegationId, delegationRevision: 1, dedupeKey: `work:${created.workId}:ask:1`, kind: "decision", title: "Question", whatHappened: "Question", whyItMatters: "Test", nextStep: "Answer" } });
  const ref = await db.$transaction(tx => ensureRef(tx, "attentionItem", item.id));
  expect(await response(ref, "feedback", "Answer")).toMatchObject({ state: "received" });
  expect(await response(ref, "feedback", "Stale")).toMatchObject({ status: "conflict" });
  const next = (await service.claimDue())[0]!;
  expect(await service.callTool(next.token, "chrona_get_context", {})).toMatchObject({ data: { inputs: [{ kind: "answer", text: "Answer" }] } });
});
test("follow-ups wake only resting work and quiet close restores its resting state", async () => {
  const { service, claim, created } = await onlyNewWork();
  await service.callTool(claim.token, "chrona_ask_user", { questions: [{ question: "More?", why: "Clarify" }] });
  await service.finishAttempt(claim.attemptId, { outcome: "exited" });
  await db.stewardWork.update({ where: { id: created.workId }, data: { status: "result_ready" } });
  await db.followUp.create({ data: { id: `work:${created.workId}:1`, workspaceId: "ws", affairId: created.affairId, note: "Test follow-up", dueAt: at } });
  expect(await service.wakeDueFollowUps()).toEqual({ woken: 1 }); expect(await service.wakeDueFollowUps()).toEqual({ woken: 0 });
  const next = (await service.claimDue())[0]!; expect(next.wakeReason).toBe("follow_up_due");
  await service.callTool(next.token, "chrona_close_quietly", { reason: "No change" });
  expect(await db.stewardWork.findUnique({ where: { id: created.workId } })).toMatchObject({ status: "result_ready" });
});
test("authorization decisions wake without granting authority; result done accepts work only", async () => {
  const { service, claim, created } = await onlyNewWork();
  await service.finishAttempt(claim.attemptId, { outcome: "unavailable" });
  const decision = async (suffix: string, kind: string) => {
    const item = await db.attentionItem.create({ data: { workspaceId: "ws", affairId: created.affairId, delegationId: created.delegationId, delegationRevision: 1, kind, dedupeKey: `work:${created.workId}:${suffix}`, title: "Test decision", whatHappened: "Test", whyItMatters: "Test", nextStep: "Test" } });
    return db.$transaction(tx => ensureRef(tx, "attentionItem", item.id));
  };
  const respond = (ref: string, action: "confirm" | "decline" | "done") => chatService().respond({ requestId: crypto.randomUUID(), chat: { ...identity, userText: `${ref} ${action}` }, ref, action });
  await db.stewardWork.update({ where: { id: created.workId }, data: { status: "waiting_authorization" } });
  const declined = await decision("authorization:1", "decision");
  expect(await respond(declined, "decline")).toMatchObject({ state: "waiting_authorization" });
  expect(await respond(declined, "confirm")).toMatchObject({ status: "conflict" });
  const ref = await decision("authorization:2", "decision"), before = await db.delegation.findUnique({ where: { id: created.delegationId } });
  expect(await respond(ref, "confirm")).toMatchObject({ state: "received" });
  expect(await db.delegation.findUnique({ where: { id: created.delegationId } })).toEqual(before);
  expect(await db.stewardWork.findUnique({ where: { id: created.workId } })).toMatchObject({ inputs: [{ kind: "decision", text: "用户已同意：Test decision" }] });
  await db.stewardWork.update({ where: { id: created.workId }, data: { status: "result_ready" } });
  expect(await respond(await decision("result:1", "result"), "done")).toMatchObject({ state: "accepted" });
  expect(await db.taskResultReview.count()).toBe(0);
});
test("competing claims yield a single capability", async () => {
  const { service, claim } = await onlyNewWork();
  await service.finishAttempt(claim.attemptId, { outcome: "unavailable" });
  await db.stewardWork.update({ where: { id: claim.workId }, data: { nextRunAt: at } });
  const results = await Promise.all([service.claimDue(), service.claimDue()]);
  expect(results.flat()).toHaveLength(1);
});
test("per-work daily run budget blocks the ninth attempt", async () => {
  let clock = at; const { service, claim, created } = await onlyNewWork(() => clock);
  let current = claim;
  for (let i = 0; i < 8; i++) { await service.finishAttempt(current.attemptId, { outcome: "unavailable" }); clock = new Date(clock.getTime() + 300_000); if (i < 7) current = (await service.claimDue())[0]!; }
  expect(await service.claimDue()).toEqual([]);
  expect(await db.stewardWork.findUnique({ where: { id: created.workId } })).toMatchObject({ status: "received", failures: 0 });
});
