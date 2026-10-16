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
for (const tool of ["chrona_affair_create", "chrona_focus"]) test(`${tool} replaces this run's provisional links, including later replies`, async () => {
  const previous = await service.forWorkspace(workspaceId).affairs.create({ title: "Previous focus" });
  await db.run.update({ where: { id: runId }, data: { affairId: previous.id } });
  await db.message.updateMany({ data: { affairId: previous.id } });
  const inbound = await db.message.findFirstOrThrow();
  await db.audit.create({ data: { workspaceId, actorKey: "chrona", kind: "chat_run_input", subjectId: runId, details: { messageId: inbound.id } } });
  await call("chrona_reply", { text: "Before focus" });
  const other = await db.message.create({ data: { workspaceId, channel: "in_app", direction: "out", conversationKey: "in_app", text: "Unrelated", at: ports.now() } });
  const affair = tool === "chrona_focus" ? await service.forWorkspace(workspaceId).affairs.create({ title: "Existing" }) : null;
  const result = await call(tool, affair ? { affairId: affair.id } : { title: "New" }) as { id: string };
  const id = affair?.id ?? result.id;
  await call("chrona_reply", { text: "After focus" });
  expect(await db.message.count({ where: { affairId: id } })).toBe(3);
  expect((await db.message.findUniqueOrThrow({ where: { id: other.id } })).affairId).toBeNull();
});
for (const status of ["paused", "done"] as const) test(`running affair can finish describing ${status}, but cannot act`, async () => {
  const api = service.forWorkspace(workspaceId), affair = await api.affairs.create({ title: "Work" });
  await db.run.update({ where: { id: runId }, data: { affairId: affair.id } });
  await call("chrona_affair_update", { affairId: affair.id, status });
  const spec = { root: "button", elements: { button: { type: "Button", props: { label: "Stopped" }, children: [] } } };
  expect(await call("chrona_ui_set", { path: "state.ui.json", spec, role: "entry" })).toMatchObject({ ok: true });
  await call("chrona_reply", { text: "Stopped" });
  await call("chrona_notify", { level: "digest", title: "Stopped", body: "Stopped" });
  for (const tool of ["chrona_schedule", "chrona_send_email", "chrona_request_approval", "chrona_inbound"]) await expect(call(tool)).rejects.toMatchObject({ code: "forbidden" });
  await expect(api.runs.enqueue({ affairId: affair.id, lane: "background", trigger: "schedule", prompt: "New" })).rejects.toMatchObject({ code: "conflict" });
});
for (const status of ["paused", "done"] as const) test(`run in A may describe B it ${status}, but not schedule B`, async () => {
  const api = service.forWorkspace(workspaceId), a = await api.affairs.create({ title: "A" }), b = await api.affairs.create({ title: "B" });
  await db.run.update({ where: { id: runId }, data: { affairId: a.id } });
  await call("chrona_affair_update", { affairId: b.id, status });
  const spec = { root: "button", elements: { button: { type: "Button", props: { label: "Stopped" }, children: [] } } };
  expect(await call("chrona_ui_set", { affairId: b.id, path: "state.ui.json", spec, role: "entry" })).toMatchObject({ ok: true });
  await call("chrona_focus", { affairId: b.id });
  await call("chrona_reply", { text: "B stopped" });
  expect((await db.message.findFirstOrThrow({ where: { text: "B stopped" } })).affairId).toBe(b.id);
  await call("chrona_notify", { level: "digest", title: "B stopped", body: "Stopped" });
  await expect(call("chrona_schedule", { affairId: b.id, mode: "wake", rule: { kind: "at", at: ports.now().toISOString() }, label: "Work", text: "Work" })).rejects.toMatchObject({ code: "conflict" });
  const other = await api.affairs.create({ title: "Stopped by user" });
  await api.affairs.update(other.id, { status });
  await expect(call("chrona_ui_set", { affairId: other.id, path: "state.ui.json", spec, role: "entry" })).rejects.toMatchObject({ code: "conflict" });
  await db.run.update({ where: { id: runId }, data: { affairId: other.id } });
  await expect(call("chrona_reply", { text: "Not my pause" })).rejects.toMatchObject({ code: "forbidden" });
});

test("sent today excludes response notifications", async () => {
  for (const idempotencyKey of ["response:answer", "tool:proactive"]) await db.notification.create({ data: { workspaceId, channel: "chrona_qqbot", level: "now", title: "Sent", body: "Sent", status: "sent", idempotencyKey, sentAt: ports.now() } });
  expect((await service.forWorkspace(workspaceId).settings.get()).chat.sentToday).toBe(1);
});
for (const linked of [false, true]) test(`schedule context retains root conversation (linked=${linked})`, async () => {
  const api = service.forWorkspace(workspaceId), affair = await api.affairs.create({ title: "Page" });
  if (linked) await db.message.updateMany({ data: { affairId: affair.id } });
  await db.audit.create({ data: { workspaceId, actorKey: "chrona", kind: "conversation_focus", subjectId: "in_app", details: { affairId: affair.id } } });
  const prompts: string[] = [];
  ports.provider = { name: "fake", health: async () => ({ available: true, sandboxed: true, error: null }), start: input => {
    prompts.push(input.prompt);
    return { done: new Promise(() => {}), inject: async () => {}, abort: async () => {} };
  } };
  await api.schedules.create(affair.id, { mode: "wake", rule: { kind: "at", at: ports.now().toISOString() }, text: "Make page", label: "Page" }, "chrona");
  await service.tick();
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain('"text":"hello"');
});
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
  await expect(call("chrona_schedule", { mode: "wake", label: "Review", rule: { kind: "every", minutes: 5 }, text: "review" })).rejects.toThrow("then pass affairId");
  const a = await call("chrona_affair_create", { title: "Study", readme: "# Study\n\nProgress" }) as { id: string; path: string };
  expect(a.path).not.toContain("/");
  expect((await service.forWorkspace(workspaceId).affairs.detail(a.id)).affair.summary).toBe("Progress");
  expect(await call("chrona_focus", { affairId: a.id })).toEqual({ affairId: a.id, path: a.path });
  expect((await db.audit.findFirstOrThrow({ where: { kind: "conversation_focus" } })).subjectId).toBe("in_app");
  const input = { mode: "wake", label: "Review", rule: { kind: "every", minutes: 5 }, text: "review" };
  const s = await call("chrona_schedule", input) as { id: string };
  expect(await call("chrona_schedules")).toMatchObject([{ id: s.id, label: "Review", createdBy: "chrona" }]);
  const other = await service.forWorkspace(workspaceId).affairs.create({ title: "Other" });
  expect(await call("chrona_schedules", { affairId: other.id })).toEqual([]);
  await call("chrona_schedule_cancel", { scheduleId: s.id });
  await call("chrona_affair_update", { affairId: a.id, title: "Updated" });
  expect(await call("chrona_affairs")).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Updated" })]));
  await call("chrona_notify", { level: "digest", title: "Update", body: "Progress" });
  expect(await db.notification.count()).toBe(1);
});
for (const state of ["running", "queued", "none", "failed_inject"] as const) test(`immediate wake: ${state}`, async () => {
  const api = service.forWorkspace(workspaceId), affair = await api.affairs.create({ title: "Work" });
  const own = await api.affairs.create({ title: "Different foreground affair" });
  await db.run.update({ where: { id: runId }, data: { affairId: own.id } });
  const injected: string[] = [];
  const background = state === "none" ? null : await api.runs.enqueue({ affairId: affair.id, lane: "background", trigger: "schedule", prompt: "Original", label: "Existing" });
  if (background && state !== "queued") {
    await api.runs.claimNext("background");
    liveRuns.set(background.id, { done: new Promise(() => {}), abort: async () => {}, inject: async text => { if (state === "failed_inject") throw new Error("fake failure"); injected.push(text); } });
  }
  const result = await call("chrona_schedule", { affairId: affair.id, mode: "wake", label: "New work", rule: { kind: "at", at: ports.now().toISOString() }, text: "New instruction" });
  if (state === "running" || state === "queued") {
    expect(result).toMatchObject({ merged: true, runId: background!.id });
    expect(await db.schedule.count()).toBe(0);
    expect(await db.audit.count({ where: { kind: "wake_merged", subjectId: background!.id } })).toBe(1);
    if (state === "running") expect(injected).toEqual(["Additional instruction for the work in progress (from the conversation): New instruction"]);
    else expect((await db.run.findUniqueOrThrow({ where: { id: background!.id } })).prompt).toBe("Original\n\nAdditional instruction added later: New instruction");
  } else {
    expect(result).toMatchObject({ label: "New work", createdBy: "chrona" });
    expect(await db.schedule.count()).toBe(1);
  }
});

test("notify answering the user's own request bypasses the cap; unsolicited ones keep it", async () => {
  const api = service.forWorkspace(workspaceId), affair = await api.affairs.create({ title: "Plan" });
  await api.settings.update({ notifications: { dailyCap: 0 } });
  await api.runs.enqueue({ affairId: affair.id, lane: "background", trigger: "schedule", prompt: "work" });
  const run = (await api.runs.claimNext("background"))!;
  const call2 = (input: unknown) => service.tools.call(run.token, "chrona_notify", input);
  expect(await call2({ level: "now", title: "Checked", body: "Nothing asked for" })).toMatchObject({ status: "folded" });
  await db.message.create({ data: { workspaceId, channel: "in_app", direction: "in", conversationKey: "in_app", text: "make the plan", affairId: affair.id, at: new Date(ports.now().getTime() + 1) } });
  ports.now = () => new Date("2026-10-15T04:00:05Z");
  expect(await call2({ level: "now", title: "Plan ready", body: "Open it" })).toMatchObject({ status: "queued" });
  expect((await db.notification.findFirstOrThrow({ where: { title: "Plan ready" } })).idempotencyKey).toMatch(/^response:/);
  expect(await call2({ level: "now", title: "Also", body: "Second" })).toMatchObject({ status: "folded" });
});
test("immediate wake extends a due wake that has not fired yet", async () => {
  const api = service.forWorkspace(workspaceId), affair = await api.affairs.create({ title: "Work" });
  const input = { affairId: affair.id, mode: "wake", label: "Plan", rule: { kind: "at", at: ports.now().toISOString() } };
  const first = await call("chrona_schedule", { ...input, text: "Write the plan" }) as { id: string };
  expect(await call("chrona_schedule", { ...input, text: "Use the new target" })).toMatchObject({ merged: true, runId: first.id });
  expect(await db.schedule.count()).toBe(1);
  expect((await db.schedule.findUniqueOrThrow({ where: { id: first.id } })).text).toBe("Write the plan\n\nAdditional instruction added later: Use the new target");
});
test("a background run scheduling follow-up work for its own affair gets a new wake", async () => {
  const api = service.forWorkspace(workspaceId), affair = await api.affairs.create({ title: "Work" });
  await api.runs.enqueue({ affairId: affair.id, lane: "background", trigger: "schedule", prompt: "Original" });
  const own = (await api.runs.claimNext("background"))!;
  const injected: string[] = [];
  liveRuns.set(own.id, { done: new Promise(() => {}), abort: async () => {}, inject: async text => { injected.push(text); } });
  const result = await service.tools.call(own.token, "chrona_schedule", { mode: "wake", label: "Continue", rule: { kind: "at", at: ports.now().toISOString() }, text: "Continue" });
  expect(result).toMatchObject({ label: "Continue", createdBy: "chrona" });
  expect(injected).toEqual([]);
});
test("merge is limited to immediate wakes and preserves validation and policy", async () => {
  const api = service.forWorkspace(workspaceId), affair = await api.affairs.create({ title: "Work" });
  const background = await api.runs.enqueue({ affairId: affair.id, lane: "background", trigger: "schedule", prompt: "Original" });
  const input = { affairId: affair.id, mode: "wake", label: "Work", rule: { kind: "at", at: ports.now().toISOString() }, text: "Extra" };
  await call("chrona_schedule", { ...input, rule: { kind: "at", at: new Date(ports.now().getTime() + 60001).toISOString() } });
  await call("chrona_schedule", { ...input, mode: "remind" });
  await expect(call("chrona_schedule", { ...input, command: "invalid" })).rejects.toMatchObject({ code: "invalid" });
  await api.grants.create({ action: "schedule", mode: "never", scope: { kind: "affair", affairId: affair.id } });
  await expect(call("chrona_schedule", input)).rejects.toMatchObject({ code: "forbidden" });
  expect(await db.schedule.count()).toBe(2);
  expect((await db.run.findUniqueOrThrow({ where: { id: background.id } })).prompt).toBe("Original");
  expect(await db.audit.count({ where: { kind: "wake_merged" } })).toBe(0);
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
