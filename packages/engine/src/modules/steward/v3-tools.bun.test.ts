import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHRONA_TOOLS, RUN_LIMITS } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { createStewardService } from "./service";
import type { StewardPorts } from "./ports";
import { liveRuns } from "./runs";
let db: ReturnType<typeof testDb>, ports: StewardPorts, service: ReturnType<typeof createStewardService>;
let workspaceId: string, token: string, runId: string;
let deliveries: string[], approved: unknown[];
beforeEach(async () => {
  db = testDb(); deliveries = []; approved = [];
  workspaceId = (await db.workspace.create({ data: { name: "tools" } })).id;
  ports = { db, now: () => new Date("2026-10-15T04:00:00Z"), dataDir: await mkdtemp(join(tmpdir(), "chrona-v3b-")), publicUrl: null, chat: null,
    deliveries: [{ channel: "in_app", send: async m => { deliveries.push(m.body); return { outcome: "accepted", receiptRef: null }; } }],
    onApproved: async action => { approved.push(action); },
  };
  service = createStewardService(ports);
  await db.message.create({ data: { workspaceId, channel: "in_app", direction: "in", conversationKey: "in_app", text: "hello", at: ports.now() } });
  const runs = service.forWorkspace(workspaceId).runs;
  await runs.enqueue({ lane: "foreground", trigger: "message", prompt: "hello", conversationKey: "in_app" });
  const run = (await runs.claimNext("foreground"))!; token = run.token; runId = run.id;
});
afterEach(async () => { liveRuns.clear(); await db.$disconnect(); });
const call = (name: string, input: unknown = {}) => service.tools.call(token, name, input);
test("catalog authenticates; every contract tool has a schema; invalid calls are counted and audited", async () => {
  expect((await service.tools.catalog(token)).map(t => t.name)).toEqual(CHRONA_TOOLS);
  await expect(service.tools.catalog("invalid")).rejects.toMatchObject({ code: "forbidden" });
  await expect(call("unknown")).rejects.toMatchObject({ code: "invalid" });
  await expect(call("chrona_reply", { text: "hello", workspaceId: "other" })).rejects.toMatchObject({ code: "invalid" });
  const row = await db.run.findUniqueOrThrow({ where: { id: runId } });
  expect(row.toolCalls).toMatchObject([{ ok: false }, { ok: false }]);
  expect(await db.audit.count({ where: { kind: "tool_finished" } })).toBe(2);
});
test("reply stores outbound and delivers; preferences and inbound are workspace bounded", async () => {
  await call("chrona_reply", { text: "answer" });
  expect(deliveries).toEqual(["answer"]);
  expect(await db.message.count({ where: { direction: "out", workspaceId } })).toBe(1);
  const preference = await call("chrona_remember", { text: "Prefer short answers" }) as { id: string };
  expect(await call("chrona_preferences")).toMatchObject([{ id: preference.id }]);
  await call("chrona_forget", { preferenceId: preference.id });
  expect(await call("chrona_preferences")).toEqual([]);
  expect(await call("chrona_inbound")).toEqual([]);
  await expect(call("chrona_inbound", { connectorId: "other" })).rejects.toMatchObject({ code: "not_found" });
});
test("root schedules require an affair, then resolve conversation focus", async () => {
  await expect(call("chrona_schedules")).rejects.toThrow("chrona_affair_create / chrona_focus");
  await expect(call("chrona_schedule", { mode: "wake", rule: { kind: "every", minutes: 5 }, text: "review" })).rejects.toThrow("then pass affairId");
  const a = await call("chrona_affair_create", { title: "Study", readme: "# Study\n\nProgress" }) as { id: string; path: string };
  expect(a.path).not.toContain("/");
  expect((await service.forWorkspace(workspaceId).affairs.detail(a.id)).affair.summary).toBe("Progress");
  expect(await call("chrona_focus", { affairId: a.id })).toEqual({ affairId: a.id, path: a.path });
  expect((await db.audit.findFirstOrThrow({ where: { kind: "conversation_focus" } })).subjectId).toBe("in_app");
  const input = { mode: "wake", rule: { kind: "every", minutes: 5 }, text: "review" };
  const s = await call("chrona_schedule", input) as { id: string };
  expect(await call("chrona_schedules")).toMatchObject([{ id: s.id }]);
  const other = await service.forWorkspace(workspaceId).affairs.create({ title: "Other" });
  expect(await call("chrona_schedules", { affairId: other.id })).toEqual([]);
  await call("chrona_schedule_cancel", { scheduleId: s.id });
  await call("chrona_affair_update", { affairId: a.id, title: "Updated" });
  expect(await call("chrona_affairs")).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Updated" })]));
  await call("chrona_notify", { level: "digest", title: "Update", body: "Progress" });
  expect(await db.notification.count()).toBe(1);
});
test("email stores exact payload and never sends before approval; owner resolve invokes seam only once", async () => {
  const connector = await db.connector.create({ data: { workspaceId, kind: "email", label: "fake", canSend: true } });
  const input = { connectorId: connector.id, to: ["recipient@example.invalid"], subject: "Subject", body: "Body", inReplyTo: "message-1" };
  const approval = await call("chrona_send_email", input) as { id: string };
  expect(approved).toEqual([]); expect(deliveries).toEqual([]);
  expect((await db.approval.findUniqueOrThrow({ where: { id: approval.id } })).payload).toEqual({ tool: "chrona_send_email", ...input });
  const owner = service.forWorkspace(workspaceId);
  await owner.approvals.resolve(approval.id, { decision: "approve", scope: "once" });
  expect(approved).toMatchObject([{ approvalId: approval.id, payload: { tool: "chrona_send_email", ...input } }]);
  await expect(owner.approvals.resolve(approval.id, { decision: "approve" })).rejects.toMatchObject({ code: "conflict" });
  expect(approved).toHaveLength(1);
  await owner.grants.create({ action: "send_external_message", mode: "never", scope: { kind: "global" } });
  await expect(call("chrona_send_email", input)).rejects.toMatchObject({ code: "forbidden" });
  await expect(call("chrona_request_approval", { action: "send_external_message", title: "Send", detail: "Please", preview: "body" })).rejects.toMatchObject({ code: "forbidden" });
});
test("denial never invokes executor; capability expires; call limit has no side effect", async () => {
  const a = await call("chrona_request_approval", { action: "send_external_message", title: "Send", detail: "Please", preview: "body" }) as { id: string };
  await service.forWorkspace(workspaceId).approvals.resolve(a.id, { decision: "deny" }); expect(approved).toEqual([]);
  await db.run.update({ where: { id: runId }, data: { toolCalls: Array.from({ length: RUN_LIMITS.maxChronaToolCalls }, () => ({ tool: "chrona_preferences", at: ports.now().toISOString(), ok: true })) } });
  await expect(call("chrona_reply", { text: "blocked" })).rejects.toMatchObject({ code: "forbidden" });
  expect(deliveries).toEqual([]);
  await db.run.update({ where: { id: runId }, data: { status: "finished" } });
  await expect(service.tools.catalog(token)).rejects.toMatchObject({ code: "forbidden" });
});
test("fake provider calls authenticated tools in-process through tick", async () => {
  await service.forWorkspace(workspaceId).runs.finish(runId, { outcome: "finished", sessionId: null, error: null });
  ports.provider = { name: "fake", health: async () => ({ available: true, sandboxed: true, error: null }), start: input => ({ inject: async () => {}, abort: async () => {}, done: (async () => {
    expect(input.prompt).toContain("Context (data)");
    expect(input.prompt).toContain("root is NOT an affair");
    expect(input.prompt).toContain("first use chrona_affair_create or chrona_focus");
    expect(input.prompt).toContain("<dirName>/");
    await service.tools.call(input.token, "chrona_reply", { text: "provider answer" });
    return { outcome: "finished" as const, sessionId: null, error: null };
  })() }) };
  const queued = await service.forWorkspace(workspaceId).runs.enqueue({ lane: "foreground", trigger: "message", prompt: "hi", conversationKey: "in_app" });
  await service.tick();
  for (let i = 0; i < 100; i++) {
    if ((await db.run.findUniqueOrThrow({ where: { id: queued.id } })).status === "finished") break;
    await Bun.sleep(10);
  }
  expect((await db.run.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe("finished");
  expect(deliveries).toEqual(["provider answer"]);
});
