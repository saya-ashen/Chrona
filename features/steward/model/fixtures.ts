import { affairDetailSchema, affairSchema, approvalSchema, todayViewSchema, chatReplySchema, fileContentSchema, scheduleSchema } from "@chrona/contracts";

export const fixtureTime = "2026-10-15T10:42:00+08:00";
export function affairFixture() {
  return affairSchema.parse({ id: "camera", title: "二手相机选购", summary: "已加入富士比较", status: "active", nextSchedule: null, running: false, work: null, openApprovals: 1, createdAt: fixtureTime, lastActivityAt: fixtureTime });
}
export function approvalFixture() {
  return approvalSchema.parse({ id: "email", affairId: "camera", affairTitle: "二手相机选购", action: "send_external_message", status: "open", title: "发送询价邮件", detail: "向卖家询价", preview: "请问相机还在吗？", createdAt: fixtureTime, resolvedAt: null });
}
export function fileFixture() {
  return fileContentSchema.parse({ path: "README.md", content: "# 相机\n\n- [ ] 比较镜头", mime: "text/markdown", revision: "abc123", updatedAt: fixtureTime });
}
export function scheduleFixture() {
  return scheduleSchema.parse({ id: "reminder", affairId: "camera", mode: "remind", label: null, rule: { kind: "daily", time: "18:00" }, text: "比较镜头", command: null, until: null, status: "active", nextAt: fixtureTime, lastAt: null, lastResult: null, createdBy: "chrona", createdAt: fixtureTime });
}
export function detailFixture() {
  return affairDetailSchema.parse({ entry: "README.md", affair: affairFixture(), files: [{ path: "README.md", kind: "file", size: 50, updatedAt: fixtureTime }], schedules: [scheduleFixture()], approvals: [approvalFixture()], activity: [], runs: [], revisions: [], messages: [] });
}
export function emptyToday() {
  return todayViewSchema.parse({ generatedAt: fixtureTime, approvals: [], upcoming: [], progress: [], todayPage: null, health: { provider: { available: true, name: "Pi", sandboxed: true, lastError: null }, git: true, jobsSandbox: true, queuedRuns: 0, runningRuns: 0, failedRunsToday: 0, dueSchedules: 0, failingConnectors: 0, queuedNotifications: 0, failedNotifications: 0, lastTickAt: fixtureTime } });
}
export function todayFixture() {
  return todayViewSchema.parse({ ...emptyToday(), approvals: [approvalFixture()], upcoming: [{ scheduleId: "reminder", affairId: "camera", affairTitle: "二手相机选购", mode: "remind", label: "比较镜头", at: fixtureTime }], progress: [{ affair: affairFixture(), updates: [{ title: "比较已备好", body: "加入富士比较", at: fixtureTime }], changedPages: 2, card: null }] });
}
export const chatFixture = chatReplySchema.parse({ runId: "chat-1", messages: [{ id: "reply-1", direction: "out", channel: "in_app", text: "好，我把预算改成 6000 并加上富士。", attachments: [{ name: "相机比较", path: "README.md", mime: "text/markdown", size: 50 }], affairId: "camera", quotedMessageId: null, at: fixtureTime }] });
