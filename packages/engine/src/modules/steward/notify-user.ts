import type { Prisma } from "@chrona/db";
import { NOTIFY_INTERFACE, notificationChannelSchema, notificationSchema, type NotificationSettings } from "@chrona/contracts/steward";
import { z } from "zod";
import type { StewardPorts } from "./ports";
import { callSync, enqueueCall, kernelOrigin } from "./module-calls";

/** What Chrona tells the user. Budget, channel and recipient are decided by the module behind `notify.send`. */
export type UserNotice = {
  title: string; body: string; level: "now" | "digest" | "web";
  /** Idempotency key of the notice; a repeat is dropped. */
  key: string;
  /** The app (module id and name) the notice is about, for links, digests and feedback. */
  module?: string; app?: string; session?: string; approval?: string; scoped?: boolean;
  urgent?: boolean; responds?: boolean; recipient?: string;
};
type Db = StewardPorts["db"] | Prisma.TransactionClient;
const NOTIFY = NOTIFY_INTERFACE.split(".")[0]!;
const isDefined = (value: unknown) => value !== undefined;
/** Queues the notice in the caller's transaction, so it commits (or rolls back) with what it reports. */
export function notifyUser(tx: Db, ports: StewardPorts, workspaceId: string, notice: UserNotice) {
  const args = Object.fromEntries(Object.entries({ ...notice, title: notice.title.slice(0, 200), body: notice.body.slice(0, 4000) }).filter(entry => isDefined(entry[1])));
  return enqueueCall({ tx, ports, origin: kernelOrigin(workspaceId), target: NOTIFY_INTERFACE, raw: args }, { key: `notify:${notice.key}`.slice(0, 200) });
}
/** Withdraws a queued notice that is no longer relevant (e.g. a question that was answered elsewhere). */
export function withdrawNotice(tx: Db, ports: StewardPorts, workspaceId: string, key: string) {
  return enqueueCall({ tx, ports, origin: kernelOrigin(workspaceId), target: `${NOTIFY}.withdraw`, raw: { key } }, { key: `withdraw:${key}`.slice(0, 200) });
}
/** Every open approval is announced once, wherever it was created; the user is waiting on it, so no cap or quiet hours. */
export async function announceApprovals(ports: StewardPorts, workspaceId: string) {
  for (const row of await ports.db.approval.findMany({ where: { workspaceId, status: "open" }, orderBy: { createdAt: "asc" }, take: 50 })) {
    await notifyUser(ports.db, ports, workspaceId, { ...(row.moduleId ? { module: row.moduleId } : {}), approval: row.id, scoped: false, level: "now", responds: true,
      title: `需要你批准：${row.title}`, body: approvalNoticeBody(row), key: `approval:${row.id}` });
  }
}
/**
 * Chat shows the decision, not the review: a module version keeps its capabilities and intended changes,
 * and the manifest/code diff, tests and hash stay on the page. A group (v2-15) lists each module the same way.
 * Other approvals (e.g. data restores) keep their full text.
 */
export function approvalNoticeBody(row: { action: string; detail: string | null; preview: string | null }) {
  const full = () => [row.detail, row.preview].filter(Boolean).join("\n\n").slice(0, 1500);
  if (row.action !== "activate_module" || !row.preview) return full();
  const sections = row.preview.startsWith("【") ? row.preview.split(/\n\n(?=【[^】\n]+】\n)/) : [row.preview];
  const summaries = sections.map(section => moduleSummary(section.split("\n")));
  if (summaries.some(summary => summary === null)) return full();
  return [row.detail, ...summaries, "完整差异、测试结果和 hash 请在网页「待你决定」中查看。"].filter(Boolean).join("\n\n").slice(0, 1500);
}
function moduleSummary(lines: string[]) {
  const diffAt = lines.findIndex(line => line.startsWith("--- active"));
  if (diffAt < 0) return null;
  let changes: string[] = [];
  try { changes = z.object({ changes: z.string().array() }).parse(JSON.parse(lines.find(line => line.startsWith("意图："))?.slice(3) ?? "")).changes; } catch { /* no readable intent: the page has it */ }
  return [lines.slice(0, diffAt).join("\n"), changes.length ? `改动：\n${changes.map(change => `• ${change}`).join("\n")}` : null].filter(Boolean).join("\n");
}
/** Forwards the user's notification settings (kept in the workspace, where the page edits them) to the notify module. */
export function forwardSettings(tx: Db, ports: StewardPorts, workspaceId: string, settings: NotificationSettings, at: Date) {
  return enqueueCall({ tx, ports, origin: kernelOrigin(workspaceId), target: `${NOTIFY}.configure`, raw: { "daily-cap": settings.dailyCap, timezone: settings.timezone, "digest-at": settings.digestAt, at: at.toISOString(),
    ...(settings.quietHours ? { "quiet-start": settings.quietHours.start, "quiet-end": settings.quietHours.end } : {}) } }, { key: `settings:${at.toISOString()}` });
}

/** A sync question to the notify module; null when it cannot answer (the page still renders). */
async function ask(ports: StewardPorts, workspaceId: string, tool: string, args: Record<string, unknown> = {}) {
  try { return (await callSync(ports, kernelOrigin(workspaceId), `${NOTIFY}.${tool}`, args, { timeoutMs: 10_000 })).output; }
  catch { return null; }
}
const viewNotification = notificationSchema.strip();
const statusSchema = z.object({ chat: z.object({ channel: notificationChannelSchema, bound: z.boolean(), sentToday: z.number().int().min(0) }), queued: z.number().int().min(0), failed: z.number().int().min(0) });
/** Validate item by item, ignoring extra fields while preserving the actual registered channel. */
export const notificationItems = (output: unknown) => (z.object({ items: z.array(z.unknown()) }).safeParse(output).data?.items ?? [])
  .flatMap(item => { const parsed = viewNotification.safeParse(item); return parsed.success ? [parsed.data] : []; });
/** The owner's view of notifications, answered by the notify module. */
export function createNotificationsView(ports: StewardPorts, workspaceId: string) {
  return {
    list: async (limit = 50) => notificationItems(await ask(ports, workspaceId, "list", { limit })),
    status: async () => statusSchema.safeParse(await ask(ports, workspaceId, "status")).data ?? null,
  };
}
