import type { AttentionItem, ResultSummary, TodayView } from "@chrona/contracts";
export const timestamp = "2026-10-13T12:00:00.000Z";
export function emptyToday(): TodayView {
  return { generatedAt: timestamp, decisions: [], changes: [], commitments: [], suggestions: [], results: [], recentResults: [], upcoming: [], health: { assessor: { available: true, name: "test", lastError: null }, pendingEvents: 0, failedEvents: 0, oldestPendingAt: null, queuedNotifications: 0, failedNotifications: 0, failingConnections: 0, lastTickAt: timestamp } };
}
export function publishedResult(): ResultSummary {
  return { id: "version-1", taskId: "task-1", taskTitle: "Research task", title: "Published report", version: 2, reviewState: "unreviewed", publishedAt: timestamp, href: "/tasks/task-1/results" };
}
export function decisionItem(): AttentionItem {
  return { id: "attention-1", kind: "decision", status: "open", affairId: null, affairTitle: null, eventId: null, delegationId: null, title: "Confirm follow-up", whatHappened: "A deadline moved", whyItMatters: "Your response is due sooner", nextStep: "Approve the follow-up", evidence: [{ label: "Source message", excerpt: "Please reply tomorrow", url: "https://example.com/evidence" }], dueAt: null, snoozedUntil: null, decision: null, decidedAt: null, createdAt: timestamp, updatedAt: timestamp };
}
