import type { Prisma } from "@chrona/db";
import { NOTIFY_INTERFACE, notificationSchema, type NotificationSettings } from "@chrona/contracts/steward";
import { z } from "zod";
import type { StewardPorts } from "./ports";
import { callSync, enqueueCall, kernelOrigin } from "./module-calls";
import { StewardError } from "./errors";
import { audit } from "./audit";

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
/** Queues the notice in the caller's transaction, so it commits (or rolls back) with what it reports. */
export function notifyUser(tx: Db, ports: StewardPorts, workspaceId: string, notice: UserNotice) {
  const args = Object.fromEntries(Object.entries({ ...notice, title: notice.title.slice(0, 200), body: notice.body.slice(0, 4000) }).filter(([, value]) => value !== undefined));
  return enqueueCall(tx, ports, kernelOrigin(workspaceId), NOTIFY_INTERFACE, args, { key: `notify:${notice.key}`.slice(0, 200) });
}
/** Withdraws a queued notice that is no longer relevant (e.g. a question that was answered elsewhere). */
export function withdrawNotice(tx: Db, ports: StewardPorts, workspaceId: string, key: string) {
  return enqueueCall(tx, ports, kernelOrigin(workspaceId), `${NOTIFY}.withdraw`, { key }, { key: `withdraw:${key}`.slice(0, 200) });
}
/** Every open approval is announced once, wherever it was created; the user is waiting on it, so no cap or quiet hours. */
export async function announceApprovals(ports: StewardPorts, workspaceId: string) {
  for (const row of await ports.db.approval.findMany({ where: { workspaceId, status: "open" }, orderBy: { createdAt: "asc" }, take: 50 })) {
    await notifyUser(ports.db, ports, workspaceId, { ...(row.moduleId ? { module: row.moduleId } : {}), approval: row.id, scoped: !!row.moduleId, level: "now", responds: true,
      title: `需要你批准：${row.title}`, body: [row.detail, row.preview].filter(Boolean).join("\n\n").slice(0, 1500), key: `approval:${row.id}` });
  }
}
/** Forwards the user's notification settings (kept in the workspace, where the page edits them) to the notify module. */
export function forwardSettings(tx: Db, ports: StewardPorts, workspaceId: string, settings: NotificationSettings, at: Date) {
  return enqueueCall(tx, ports, kernelOrigin(workspaceId), `${NOTIFY}.configure`, { "daily-cap": settings.dailyCap, timezone: settings.timezone, "digest-at": settings.digestAt, at: at.toISOString(),
    ...(settings.quietHours ? { "quiet-start": settings.quietHours.start, "quiet-end": settings.quietHours.end } : {}) }, { key: `settings:${at.toISOString()}` });
}

/** A sync question to the notify module; null when it cannot answer (the page still renders). */
async function ask(ports: StewardPorts, workspaceId: string, tool: string, args: Record<string, unknown> = {}) {
  try { return (await callSync(ports, kernelOrigin(workspaceId), `${NOTIFY}.${tool}`, args, { timeoutMs: 10_000 })).output; }
  catch { return null; }
}
const statusSchema = z.object({ chat: z.object({ channel: z.enum(["in_app", "chrona_qqbot"]), bound: z.boolean(), sentToday: z.number().int().min(0) }), queued: z.number().int().min(0), failed: z.number().int().min(0) });
const answerSchema = z.object({ notification: notificationSchema }).or(z.object({ error: z.string(), message: z.string().optional() }));
/** The owner's view of notifications, answered by the notify module. */
export function createNotificationsView(ports: StewardPorts, workspaceId: string) {
  async function mutate(tool: "feedback" | "retry", args: Record<string, unknown>) {
    const parsed = answerSchema.safeParse(await ask(ports, workspaceId, tool, args));
    if (!parsed.success) throw new StewardError("conflict", "Notifications are unavailable");
    if ("error" in parsed.data) throw new StewardError(parsed.data.error === "not_found" ? "not_found" : "conflict", parsed.data.message ?? parsed.data.error);
    return parsed.data.notification;
  }
  return {
    list: async (limit = 50) => z.object({ items: notificationSchema.array() }).safeParse(await ask(ports, workspaceId, "list", { limit })).data?.items ?? [],
    status: async () => statusSchema.safeParse(await ask(ports, workspaceId, "status")).data ?? null,
    /** Owner API: a message for the user (entry modules), through the normal budget. */
    enqueue: async (input: { title: string; body: string; dedupeKey: string; sessionId?: string; recipient?: string; level: "now" }) => {
      const queued = await notifyUser(ports.db, ports, workspaceId, { level: input.level, title: input.title, body: input.body, key: input.dedupeKey, ...(input.sessionId ? { session: input.sessionId } : {}), ...(input.recipient ? { recipient: input.recipient } : {}) });
      return { callId: queued.callId, status: queued.status };
    },
    recordFeedback: (id: string, feedback: "useful" | "not_useful") => mutate("feedback", { id, feedback }),
    retry: (id: string) => mutate("retry", { id }),
  };
}

const LEGACY = "notifications_moved_to_module";
/**
 * One-time, non-destructive copy of notifications recorded before the notify module existed (the Notification
 * table is left as it was) plus the current settings. Runs in one transaction with its marker.
 */
export async function moveLegacyNotifications(ports: StewardPorts, workspaceId: string) {
  const { db } = ports;
  if (await db.audit.findFirst({ where: { workspaceId, kind: LEGACY } })) return 0;
  const rows = await db.notification.findMany({ where: { workspaceId }, include: { module: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const settings = (workspace.settings as { notifications?: NotificationSettings } | null)?.notifications;
  return db.$transaction(async tx => {
    if (await tx.audit.findFirst({ where: { workspaceId, kind: LEGACY } })) return 0;
    if (settings) await forwardSettings(tx, ports, workspaceId, settings, workspace.updatedAt);
    for (let start = 0; start < rows.length; start += 100) {
      const chunk = rows.slice(start, start + 100).map(({ module, ...row }) => ({ ...row, app: module?.name ?? null }));
      await enqueueCall(tx, ports, kernelOrigin(workspaceId), `${NOTIFY}.import`, { rows: JSON.stringify(chunk) }, { key: `legacy:${start}` });
    }
    await audit(tx, { workspaceId, actor: "chrona", kind: LEGACY, subjectId: workspaceId, details: { rows: rows.length, queued: rows.filter(row => row.status === "queued").length } });
    return rows.length;
  });
}
