import { describe, expect, it } from "vitest";
import { workCaptureSchema, workSourceSchema, workUpdateSchema, workWindowSchema, type WorkView } from "@chrona/contracts";
import { deriveWorkState, proposalStale, formatWorkTime } from "./state";
const window = { startsAt: "2031-01-01T10:00:00+08:00", endsAt: "2031-01-01T11:00:00+08:00", timezone: "Asia/Shanghai" };
const base: WorkView = { record: { taskId: "t", title: "Meeting", taskStatus: "Ready", revision: "work-v1:t:0", context: { kind: "meeting", window, agenda: "", organizer: "", participants: [] }, signals: {}, cancelled: false, nextAction: "", needsAttention: false, updatedAt: "2031-01-01T00:00:00Z", lastActorKey: "external:one" }, sources: [], entries: [], pendingChanges: [], total: 0, nextOffset: null, canWrite: true, canResolve: true, schedule: window };
describe("independent work presentation", () => {
  it.each([
    ["recorded", {}, "upToDate", "chooseNext"],
    ["waiting for follow-through", { needsAttention: true }, "needsAttention", "chooseNext"],
    ["cancelled meeting is not a completed Task", { cancelled: true }, "cancelled", "cancelFollowUp"],
    ["unknown email remains actionable", { signals: { reply: { value: "unknown", actorKey: "external:a", recordedAt: "now" } } }, "upToDate", "reconcile"],
    ["failure remains actionable", { signals: { calendar: { value: "failed", actorKey: "external:a", recordedAt: "now" } } }, "upToDate", "reconcile"],
    ["meeting happened is not Task completion", { signals: { meeting: { value: "happened", actorKey: "external:a", recordedAt: "now" } } }, "upToDate", "chooseNext"],
  ] as const)("%s", (_name, patch, stateKey, nextKey) => {
    expect(deriveWorkState({ ...base, record: { ...base.record!, ...patch } })).toMatchObject({ stateKey, nextKey });
    expect(base.record!.taskStatus).toBe("Ready");
  });
  it("prioritizes pending changes and distinguishes stale proposals from permission", () => {
    const entry = { id: "e", kind: "propose", actorKey: "external:a", summary: "Date changed", createdAt: "2031-01-01T00:00:00Z", details: { baseRevision: 0 }, resolvesId: null };
    expect(deriveWorkState({ ...base, pendingChanges: [entry] })).toMatchObject({ stateKey: "changePending", nextKey: "reviewChange" });
    expect(proposalStale(base.record!, entry)).toBe(false);
    expect(proposalStale({ ...base.record!, revision: "work-v1:t:1" }, entry)).toBe(true);
    expect(deriveWorkState({ ...base, schedule: null })).toMatchObject({ mismatch: true, nextKey: "scheduleConflict" });
    expect(formatWorkTime(window, "en")).toContain("Jan");
  });
});
describe("work boundary schemas", () => {
  const capture = { requestId: "12345678-1234-4234-8234-123456789012", title: "Meeting", context: { kind: "meeting", window } };
  it.each(["actorKey", "autoExecute", "aiClientId", "mode", "permissionGranted", "taskExecutionMode"])("rejects authority/configuration injection: %s", key => {
    expect(workCaptureSchema.safeParse({ ...capture, [key]: true }).success).toBe(false);
  });
  it("validates absolute times, IANA zones and positive meeting duration", () => {
    expect(workCaptureSchema.safeParse(capture).success).toBe(true);
    expect(workWindowSchema.safeParse({ ...window, endsAt: window.startsAt }).success).toBe(false);
    expect(workWindowSchema.safeParse({ ...window, timezone: "not-a-timezone" }).success).toBe(false);
    expect(workCaptureSchema.safeParse({ ...capture, context: { kind: "meeting" } }).success).toBe(false);
  });
  it.each(["javascript:alert(1)", "file:///etc/passwd", "http://untrusted.invalid", "https://user:password@example.com"])("rejects unsafe viewing link %s", url => {
    expect(workSourceSchema.safeParse({ kind: "reference", system: "web", account: "public", externalId: "id", label: "Source", url }).success).toBe(false);
  });
  it("does not accept arbitrary signal values, hidden lifecycle fields or calendar cancellation as a report", () => {
    const update = { taskId: "t", requestId: capture.requestId, expectedRevision: "work-v1:t:1" };
    expect(workUpdateSchema.safeParse({ ...update, action: { type: "report", summary: "Done", signal: { dimension: "meeting", value: "cancelled" } } }).success).toBe(false);
    expect(workUpdateSchema.safeParse({ ...update, action: { type: "report", summary: "Approved", grantsPermission: true } }).success).toBe(false);
  });
});
