import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { db, resetTestDb, seedWorkspace } from "@chrona/db";
import { createWorkRecordsService } from "./service";
import type { WorkActor } from "./access";
import { createTask } from "../tasks/create-task";
import { deleteTask } from "../tasks/delete-task";
import { createTaskScheduleService } from "../../services/task-schedule.service";
const window = { startsAt: "2031-01-15T10:00:00+08:00", endsAt: "2031-01-15T11:00:00+08:00", timezone: "Asia/Shanghai" };
const source = { kind: "email", system: "gmail", account: "personal", externalId: "thread-1", label: "Invitation", url: "https://mail.google.com/mail/u/0/#inbox/thread-1" };
const capture = () => ({ requestId: crypto.randomUUID(), title: "Design meeting", context: { kind: "meeting", window }, sources: [source], nextAction: "Confirm the invitation" });
async function fixture() {
  const { workspaceId } = await seedWorkspace();
  const actor: WorkActor = { workspaceId, actorKey: "external:agent-one", canWrite: true, canResolve: false };
  return { actor, service: createWorkRecordsService({ authorize: async () => actor }) };
}
let enabled: string | undefined;
beforeEach(async () => { enabled = process.env.CHRONA_WORK_WRITES_ENABLED; process.env.CHRONA_WORK_WRITES_ENABLED = "true"; await resetTestDb(); });
afterEach(async () => { await resetTestDb(); if (enabled === undefined) delete process.env.CHRONA_WORK_WRITES_ENABLED; else process.env.CHRONA_WORK_WRITES_ENABLED = enabled; });
async function action(service: ReturnType<typeof createWorkRecordsService>, taskId: string, operation: unknown) {
  const record = (await service.read({ taskId })).record!;
  return service.update({ taskId, requestId: crypto.randomUUID(), expectedRevision: record.revision, action: operation });
}
describe("work recording and meeting follow-through", () => {
  it("captures manual work and an owned time block without providers, plans, runs or notifications", async () => {
    const { service } = await fixture(); const result = await service.capture(capture());
    const task = await db.task.findUniqueOrThrow({ where: { id: result.receipt.taskId } });
    expect(task).toMatchObject({ taskExecutionMode: "manual", autoExecute: false, autoPlanGeneration: false, aiClientId: null });
    expect(await db.workBlock.count()).toBe(1);
    expect(await Promise.all([db.run.count(), db.taskPlan.count(), db.executionSession.count(), db.aiFeatureRun.count()])).toEqual([0, 0, 0, 0]);
    expect((await service.read({ taskId: task.id })).record?.context.window).toEqual(window);
  });
  it("replays exact requests, deduplicates a source, and does not silently attach a new source on a match", async () => {
    const { service } = await fixture(), input = capture(); const first = await service.capture(input);
    expect(await service.capture(input)).toEqual({ ...first, replayed: true });
    const existing = await service.capture({ ...input, requestId: crypto.randomUUID(), title: "Changed", sources: [source, { ...source, externalId: "thread-2" }] });
    expect(existing.receipt).toMatchObject({ taskId: first.receipt.taskId, outcome: "existing" });
    expect(await db.task.count()).toBe(1); expect(await db.workSource.count()).toBe(1);
    await expect(service.capture({ ...input, title: "Changed" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("keeps account identities distinct and rejects cross-record source merges atomically", async () => {
    const { service } = await fixture(); const one = await service.capture(capture());
    const two = await service.capture({ ...capture(), sources: [{ ...source, account: "work" }] });
    expect(two.receipt.taskId).not.toBe(one.receipt.taskId);
    await expect(action(service, one.receipt.taskId, { type: "source", source: { ...source, account: "work" } })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(service.capture({ ...capture(), sources: [source, { ...source, account: "work" }] })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(await db.workEntry.count()).toBe(2);
  });
  it("separates participation, unknown reply, calendar and meeting reports without completing tasks", async () => {
    const { service } = await fixture(); const { receipt } = await service.capture(capture()); const taskId = receipt.taskId;
    const before = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    await action(service, taskId, { type: "report", summary: "User said yes (reported)", signal: { dimension: "participation", value: "accepted" } });
    await action(service, taskId, { type: "report", summary: "Send timed out; reconcile first", signal: { dimension: "reply", value: "unknown" }, receiptRef: "attempt:1", needsAttention: false });
    await action(service, taskId, { type: "report", summary: "Calendar accepted", signal: { dimension: "calendar", value: "accepted" } });
    const view = await service.read({ taskId });
    expect(view.record?.signals).toMatchObject({ participation: { value: "accepted" }, reply: { value: "unknown", actorKey: "external:agent-one" }, calendar: { value: "accepted" } });
    expect(view.record?.signals.meeting).toBeUndefined(); expect(view.record?.needsAttention).toBe(true);
    expect(await db.task.findUniqueOrThrow({ where: { id: taskId } })).toEqual(before);
  });
  it("requires owner confirmation for proposals and updates only Chrona schedule, not Task completion", async () => {
    const { service, actor } = await fixture(); const { receipt } = await service.capture(capture()); const taskId = receipt.taskId;
    const nextWindow = { ...window, startsAt: "2031-01-16T10:00:00+08:00", endsAt: "2031-01-16T11:00:00+08:00" };
    await action(service, taskId, { type: "propose", change: { type: "reschedule", window: nextWindow, reason: "Organizer changed date" } });
    let view = await service.read({ taskId });
    expect(view.record?.context.window).toEqual(window);
    const resolve = { type: "resolve", entryId: view.pendingChanges[0].id, decision: "apply", reason: "Checked invitation" };
    await expect(action(service, taskId, resolve)).rejects.toMatchObject({ code: "FORBIDDEN" });
    actor.canResolve = true; actor.actorKey = "owner:local"; await action(service, taskId, resolve);
    view = await service.read({ taskId }); expect(view.record?.context.window).toEqual(nextWindow); expect(view.pendingChanges).toHaveLength(0);
    await action(service, taskId, { type: "propose", change: { type: "cancel", reason: "Organizer cancelled" } });
    view = await service.read({ taskId });
    await action(service, taskId, { type: "resolve", entryId: view.pendingChanges[0].id, decision: "apply", reason: "Verified the cancellation" });
    expect((await service.read({ taskId })).record?.cancelled).toBe(true);
    expect(await db.workBlock.count({ where: { taskId, status: "Scheduled" } })).toBe(0);
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("Ready");
    expect(await db.run.count()).toBe(0);
  });
  it("blocks stale proposals and mismatched schedules instead of overwriting concurrent changes", async () => {
    const { service, actor } = await fixture(); const { receipt } = await service.capture(capture()); const taskId = receipt.taskId;
    actor.canResolve = true;
    await action(service, taskId, { type: "propose", change: { type: "cancel", reason: "Cancellation" } });
    const first = (await service.read({ taskId })).pendingChanges[0];
    await action(service, taskId, { type: "report", summary: "New information" });
    await expect(action(service, taskId, { type: "resolve", entryId: first.id, decision: "apply", reason: "Apply" })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await action(service, taskId, { type: "resolve", entryId: first.id, decision: "dismiss", reason: "Superseded" });
    await action(service, taskId, { type: "propose", change: { type: "cancel", reason: "Updated cancellation" } });
    const second = (await service.read({ taskId })).pendingChanges[0];
    await db.workBlock.updateMany({ where: { taskId }, data: { scheduledStartAt: new Date("2031-01-18T10:00:00Z") } });
    await expect(action(service, taskId, { type: "resolve", entryId: second.id, decision: "apply", reason: "Apply" })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });
  it("serializes concurrent captures and rejects stale revisions without partial history", async () => {
    const { service } = await fixture(), input = capture();
    const [one, two] = await Promise.all([service.capture(input), service.capture(input)]);
    expect(one.receipt.taskId).toBe(two.receipt.taskId);
    const update = { taskId: one.receipt.taskId, requestId: crypto.randomUUID(), expectedRevision: one.receipt.revision, action: { type: "report", summary: "First" } };
    await service.update(update);
    await expect(service.update({ ...update, requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(await db.workEntry.count()).toBe(2);
  });
  it("fails closed on disabled writes, closed tasks, scope changes and caller-supplied authority", async () => {
    const { service, actor } = await fixture(); const input = capture(), first = await service.capture(input);
    process.env.CHRONA_WORK_WRITES_ENABLED = "false";
    await expect(service.capture(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await service.read({ taskId: first.receipt.taskId })).canWrite).toBe(false);
    process.env.CHRONA_WORK_WRITES_ENABLED = "true";
    await expect(Promise.resolve().then(() => service.capture({ ...capture(), actorKey: "owner:local" }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await db.task.update({ where: { id: first.receipt.taskId }, data: { status: "Done" } });
    await expect(action(service, first.receipt.taskId, { type: "report", summary: "Too late" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const { workspaceId } = await seedWorkspace(); actor.workspaceId = workspaceId;
    await expect(service.read({ taskId: first.receipt.taskId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("adopts a manual task and its native calendar association without duplicate tasks or calendar writes", async () => {
    const { service, actor } = await fixture();
    const task = await createTask({ workspaceId: actor.workspaceId, title: "Existing meeting", taskExecutionMode: "manual" });
    await createTaskScheduleService().apply({ taskId: task.taskId, dueAt: null, scheduledStartAt: new Date(window.startsAt), scheduledEndAt: new Date(window.endsAt), scheduleSource: "human" });
    const block = await db.workBlock.findFirstOrThrow({ where: { taskId: task.taskId } });
    const calendar = await db.calendarSource.create({ data: { workspaceId: actor.workspaceId, name: "Read-only source", sourceUrl: "https://calendar.invalid/feed.ics", redactedUrlLabel: "Calendar", color: "#123456", automationPolicy: "manual" } });
    const event = await db.importedCalendarEvent.create({ data: { workspaceId: actor.workspaceId, calendarSourceId: calendar.id, taskId: task.taskId, workBlockId: block.id, externalUid: "invitation-uid", dedupeKey: "invitation-uid", title: "Existing meeting", startsAt: new Date(window.startsAt), endsAt: new Date(window.endsAt) } });
    const before = await db.task.findUniqueOrThrow({ where: { id: task.taskId } });
    const nativeSource = { kind: "calendar", system: "chrona-calendar", account: calendar.id, externalId: event.id, calendarEventId: event.id, label: "Source-owned invitation" };
    const captured = await service.capture({ ...capture(), title: "Existing meeting", sources: [nativeSource] });
    expect(captured.receipt).toMatchObject({ taskId: task.taskId, outcome: "adopted" });
    expect(await db.task.count()).toBe(1); expect(await db.workSource.count()).toBe(1);
    expect(await db.task.findUniqueOrThrow({ where: { id: task.taskId } })).toEqual(before);
    await action(service, task.taskId, { type: "propose", change: { type: "cancel", reason: "Source reports cancellation" } });
    actor.canResolve = true;
    const pending = (await service.read({ taskId: task.taskId })).pendingChanges[0];
    await expect(action(service, task.taskId, { type: "resolve", entryId: pending.id, decision: "apply", reason: "Must not overwrite source" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await db.importedCalendarEvent.findUniqueOrThrow({ where: { id: event.id } })).toEqual(event);
    expect(await db.workBlock.findUniqueOrThrow({ where: { id: block.id } })).toEqual(block);
  });
  it("does not convert managed tasks or change existing schedule during explicit adoption", async () => {
    const { service, actor } = await fixture();
    const manual = await createTask({ workspaceId: actor.workspaceId, title: "Existing manual", taskExecutionMode: "manual" });
    await expect(service.capture({ ...capture(), taskId: manual.taskId, title: "Existing manual" })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const managed = await createTask({ workspaceId: actor.workspaceId, title: "Existing AI", taskExecutionMode: "ai" });
    await expect(service.capture({ ...capture(), taskId: managed.taskId, title: "Existing AI", context: { kind: "general" } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await db.workRecord.count()).toBe(0);
    const adopted = await service.capture({ ...capture(), taskId: manual.taskId, title: "Existing manual", context: { kind: "general" } });
    expect(adopted.receipt.outcome).toBe("adopted"); expect(await db.task.count()).toBe(2);
  });
  it("keeps pending/unknown work in follow-up and excludes terminal manual tasks without deleting history", async () => {
    const { service } = await fixture(), { receipt } = await service.capture(capture());
    await action(service, receipt.taskId, { type: "report", summary: "Reply uncertain", signal: { dimension: "reply", value: "unknown" } });
    await action(service, receipt.taskId, { type: "report", summary: "Reviewed but still unknown", needsAttention: false });
    expect((await service.search({ attentionOnly: true })).items).toHaveLength(1);
    // Product decision: manual Completed, Done and Cancelled all close record writes;
    // they remain separate Task statuses and never erase work history.
    for (const status of ["Completed", "Done", "Cancelled"] as const) {
      await db.task.update({ where: { id: receipt.taskId }, data: { status } });
      expect((await service.search({ attentionOnly: true })).items).toHaveLength(0);
      expect((await service.read({ taskId: receipt.taskId })).record?.taskStatus).toBe(status);
      await expect(action(service, receipt.taskId, { type: "report", summary: "Too late" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    }
    expect((await service.read({ taskId: receipt.taskId })).total).toBe(3);
  });
  it("protects append-only receipts/history and cascades only with the owning task", async () => {
    const { service } = await fixture(), { receipt } = await service.capture(capture());
    const entry = await db.workEntry.findFirstOrThrow(), source = await db.workSource.findFirstOrThrow();
    await expect(Promise.resolve(db.workEntry.update({ where: { id: entry.id }, data: { summary: "Rewritten" } }))).rejects.toThrow();
    await expect(Promise.resolve(db.workSource.delete({ where: { id: source.id } }))).rejects.toThrow();
    await deleteTask(receipt.taskId, { expectedTaskIds: [receipt.taskId], expectedAssetIds: [] });
    expect(await Promise.all([db.workRecord.count(), db.workSource.count(), db.workEntry.count(), db.workCommand.count()])).toEqual([0, 0, 0, 0]);
  });
  it("keeps maximum Unicode metadata, sources and pending proposals readable within the response budget", async () => {
    const { service } = await fixture();
    const { receipt } = await service.capture({ ...capture(), sources: [], context: { kind: "meeting", window, agenda: "议".repeat(3500) } });
    for (let i = 0; i < 12; i++) await action(service, receipt.taskId, { type: "source", source: { ...source, label: "来".repeat(200), account: "账".repeat(100), externalId: `${i}${"源".repeat(400)}` } });
    for (let i = 0; i < 8; i++) await action(service, receipt.taskId, { type: "propose", change: { type: "cancel", reason: "核".repeat(500) } });
    await action(service, receipt.taskId, { type: "report", summary: "进".repeat(2000), nextAction: "下".repeat(1000), receiptRef: "证".repeat(500) });
    const read = await service.read({ taskId: receipt.taskId, limit: 20 });
    expect(read.sources).toHaveLength(12); expect(read.pendingChanges).toHaveLength(8); expect(read.entries.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(read))).toBeLessThanOrEqual(128 * 1024);
    await expect(action(service, receipt.taskId, { type: "propose", change: { type: "cancel", reason: "Ninth pending change" } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await service.read({ taskId: receipt.taskId })).total).toBe(22);
  });
  it("paginates stable history and supports source lookup", async () => {
    const { service } = await fixture(); const { receipt } = await service.capture(capture());
    for (let i = 0; i < 4; i++) await action(service, receipt.taskId, { type: "report", summary: `Progress ${i}` });
    const first = await service.read({ taskId: receipt.taskId, limit: 2 });
    const second = await service.read({ taskId: receipt.taskId, limit: 2, offset: first.nextOffset });
    expect(new Set([...first.entries, ...second.entries].map(e => e.id)).size).toBe(4);
    const { label: _label, url: _url, ...identity } = source;
    expect((await service.search({ source: identity })).items.map(i => i.taskId)).toEqual([receipt.taskId]);
  });
});
