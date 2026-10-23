import { appSchema, approvalSchema, todayViewSchema, chatReplySchema, fileContentSchema, scheduleSchema, runSchema, sessionSchema } from "@chrona/contracts";

export const fixtureTime = "2026-10-15T10:42:00+08:00";
export function appFixture() {
  return appSchema.parse({ id: "camera", name: "camera", description: "二手相机选购", status: "active", builtin: false, content: true, activeHash: null, entry: "README.md" });
}
export function sessionFixture() {
  return sessionSchema.parse({ id: "session-1", key: "web:session-1", source: "web", title: "相机选购", status: "active", moduleId: null, originSessionId: null, focus: ["files"], running: false, lastActivityAt: fixtureTime, createdAt: fixtureTime, endedAt: null });
}
export function approvalFixture() {
  return approvalSchema.parse({ id: "email", moduleId: "camera", action: "send_external_message", status: "open", title: "发送询价邮件", detail: "向卖家询价", preview: "请问相机还在吗？", createdAt: fixtureTime, resolvedAt: null });
}
export function fileFixture() {
  return fileContentSchema.parse({ path: "README.md", content: "# 相机\n\n- [ ] 比较镜头", mime: "text/markdown", revision: "abc123", updatedAt: fixtureTime });
}
export function scheduleFixture() {
  return scheduleSchema.parse({ id: "reminder", originSessionId: "session-1", moduleId: null, mode: "remind", label: null, rule: { kind: "daily", time: "18:00" }, text: "比较镜头", until: null, status: "active", nextAt: fixtureTime, lastAt: null, lastResult: null, createdBy: "chrona", createdAt: fixtureTime });
}
export function runFixture() {
  return runSchema.parse({ id: "run-1", sessionId: "session-1", lane: "background", trigger: "schedule", status: "failed", provider: "fake", toolCalls: [], error: "Internal provider detail", startedAt: fixtureTime, endedAt: fixtureTime, createdAt: fixtureTime, label: "Prepare day two" });
}
export function detailFixture() {
  return { entry: "README.md", app: appFixture(), files: [{ path: "README.md", kind: "file" as const, size: 50, updatedAt: fixtureTime }] };
}
export function emptyToday() {
  return todayViewSchema.parse({ generatedAt: fixtureTime, approvals: [], upcoming: [], updates: [], apps: [], sessions: [], health: { provider: { available: true, name: "Pi", sandboxed: true, lastError: null }, moduleSandbox: true, queuedRuns: 0, runningRuns: 0, failedRunsToday: 0, dueSchedules: 0, failingConnectors: 0, queuedNotifications: 0, failedNotifications: 0, lastTickAt: fixtureTime } });
}
export function todayFixture() {
  return todayViewSchema.parse({ ...emptyToday(), approvals: [approvalFixture()], upcoming: [{ scheduleId: "reminder", mode: "remind", label: "比较镜头", at: fixtureTime }], apps: [appFixture()], sessions: [sessionFixture()] });
}
export const chatFixture = chatReplySchema.parse({ runId: "chat-1", sessionId: "session-1", messages: [{ id: "reply-1", sessionId: "session-1", direction: "out", channel: "in_app", text: "好，我把预算改成 6000 并加上富士。", attachments: [{ name: "相机比较", ref: "camera/README.md", mime: "text/markdown", size: 50 }], quotedMessageId: null, at: fixtureTime }] });
