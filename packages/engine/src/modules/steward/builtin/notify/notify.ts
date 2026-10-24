import { composeDigest, deliveryStatus, foldedBeforeDigest, isDigestDue, localDayKey, RESPONSE_KEY_PREFIX, retryDelayMs, routeNotification, validSettings, type DeliveryOutcome, type Level, type Settings } from "./budget";
import type { Row, Store } from "./store";

// Built-in modules run standalone: these mirror Chrona's contract (caller, call replies).
export type Caller = { kind: "module"; module: string; moduleId: string; hash: string } | { kind: "provider"; runId: string } | { kind: "owner"; via: string | null } | { kind: "kernel" };
type CallReply = { callId: string; status: string; output?: unknown; error?: string };
export type CallResult = { callId: string; status: "succeeded" | "failed" | "unknown"; output?: unknown; error?: string };
type Ports = {
  store: Store; publicUrl: string | null;
  call(target: string, args: Record<string, unknown>, options: { mode: "async"; key: string; reply: boolean }): Promise<CallReply>;
  status(callId: string): Promise<CallReply>;
};
type Args = Record<string, unknown>;
const QQ = "chrona_qqbot";
const text = (value: unknown) => typeof value === "string" && value.length ? value : null;
const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString();
const DAY = 86_400_000;

/** The notification module's logic: budget, channel choice, delivery through `qq.deliver`, receipts. */
export function createNotify({ store, publicUrl, call, status }: Ports) {
  const base = (publicUrl ?? "").replace(/\/$/, "");
  function channelReady(name: string) {
    const value = store.get(`channel:${name}`);
    return value ? (JSON.parse(value) as { ready: boolean }).ready : false;
  }
  function view(row: Row) {
    return { id: row.id, moduleId: row.module_id, sessionId: row.session_id, level: row.level, channel: row.channel, status: row.status === "sending" ? "queued" : row.status,
      title: row.title, body: row.body, link: row.link, attempts: row.attempts, lastError: row.last_error, createdAt: iso(row.created_at)!, sentAt: iso(row.sent_at), feedback: row.feedback };
  }
  function sentToday(now: Date, settings: Settings) {
    const day = localDayKey(now, settings.timezone);
    return store.rows("SELECT * FROM notifications WHERE level = 'now' AND responds = 0 AND key NOT LIKE 'digest:%' AND (sent_at >= ? OR status IN ('queued', 'sending'))", now.getTime() - 2 * DAY)
      .filter(row => localDayKey(new Date(row.sent_at ?? row.created_at), settings.timezone) === day).length;
  }
  function send(args: Args, caller: Caller, now: Date) {
    // A module's keys are its own: another module cannot pre-empt or suppress them.
    const key = caller.kind === "module" ? `module:${caller.moduleId}:${String(args.key)}` : String(args.key);
    const existing = store.byKey(key);
    if (existing) return { id: existing.id, status: view(existing).status, duplicate: true };
    const trusted = caller.kind === "kernel";
    const moduleId = caller.kind === "module" ? caller.moduleId : trusted ? text(args.module) : null;
    const app = caller.kind === "module" ? caller.module : trusted ? text(args.app) : null;
    const responds = args.responds === true || key.startsWith(RESPONSE_KEY_PREFIX);
    const settings = store.settings();
    const negative = moduleId ? (store.db.query("SELECT COUNT(*) AS n FROM notifications WHERE module_id = ? AND feedback = 'not_useful' AND created_at >= ?").get(moduleId, now.getTime() - 30 * DAY) as { n: number }).n : 0;
    const requested = args.level as Level;
    const level: Level = !responds && negative >= 2 && requested === "now" ? "digest" : requested;
    const route = routeNotification(level, { ...settings, now, urgent: args.urgent === true, sentToday: sentToday(now, settings), responds });
    const session = text(args.session);
    const row = store.insert({ key, module_id: moduleId, app, session_id: session, approval_id: trusted ? text(args.approval) : null, scoped: args.scoped === true ? 1 : 0,
      level: requested, web: route === "web" ? 1 : 0, responds: responds ? 1 : 0, status: route === "fold" ? "folded" : "queued",
      title: String(args.title).slice(0, 200), body: String(args.body).slice(0, 4000), recipient: text(args.recipient),
      link: session ? `${base}/sessions/${session}` : moduleId ? `${base}/apps/${moduleId}` : null, created_at: now.getTime() });
    return { id: row.id, status: view(row).status, duplicate: false };
  }
  function finish(row: Row, outcome: DeliveryOutcome, attempts: number, now: Date) {
    const next = deliveryStatus(outcome, attempts);
    store.update(row.id, { status: next, call_id: null, sent_at: outcome.outcome === "accepted" ? now.getTime() : null, receipt_ref: outcome.outcome === "accepted" ? outcome.receiptRef : null,
      last_error: outcome.outcome === "accepted" ? null : outcome.error.slice(0, 500), next_attempt_at: next === "queued" ? now.getTime() + retryDelayMs(attempts) : null });
  }
  async function dispatch(row: Row, attempts: number, now: Date) {
    const args: Args = { key: row.key, title: row.title, body: row.body, ...(row.link ? { link: row.link } : {}), ...(row.recipient ? { recipient: row.recipient } : {}),
      ...(row.approval_id ? { approval: row.approval_id, scoped: row.scoped === 1 } : {}) };
    try {
      // Async with the attempt in the key: a repeat after a crash returns the same call instead of sending twice.
      const reply = await call("qq.deliver", args, { mode: "async", key: `deliver:${row.id}:${attempts}`, reply: true });
      store.update(row.id, { call_id: reply.callId });
      if (["succeeded", "failed", "unknown"].includes(reply.status)) result({ ...reply, status: reply.status as CallResult["status"] }, now);
    } catch (error) {
      finish(store.byId(row.id)!, { outcome: "rejected", retryable: true, error: `Channel unavailable: ${error instanceof Error ? error.message : String(error)}` }, attempts, now);
    }
  }
  async function deliverDue(now: Date) {
    const settings = store.settings();
    for (const row of store.rows("SELECT * FROM notifications WHERE status = 'queued' AND next_attempt_at <= ? ORDER BY created_at, id LIMIT 50", now.getTime())) {
      if (row.key.startsWith("digest:") && routeNotification("now", { ...settings, dailyCap: 1, sentToday: 0, now, urgent: false }) !== "send") continue;
      const attempts = row.attempts + 1;
      // The channel is chosen when sending: an unready chat channel falls back to the web.
      if (row.web || !channelReady(QQ)) {
        store.update(row.id, { channel: "in_app", status: "sent", attempts, sent_at: now.getTime(), receipt_ref: `in_app:${row.key}`, last_error: null, next_attempt_at: null });
        continue;
      }
      store.update(row.id, { channel: QQ, status: "sending", attempts, call_id: null, call_at: now.getTime() });
      await dispatch(row, attempts, now);
    }
  }
  /** A channel module's answer (or the kernel's verdict when it never answered). */
  function result(event: CallResult, now: Date) {
    const row = store.byCall(event.callId);
    if (!row || row.status !== "sending") return;
    const output = event.output as DeliveryOutcome | undefined;
    const valid = event.status === "succeeded" && output && typeof output === "object" && ["accepted", "rejected", "uncertain"].includes(output.outcome);
    // The channel may have reached the transport before failing: never resend an unknown outcome.
    finish(row, valid ? output : { outcome: "uncertain", error: event.error ?? "Channel returned no delivery outcome; receipt unknown" }, row.attempts, now);
  }
  async function recover(now: Date) {
    for (const row of store.rows("SELECT * FROM notifications WHERE status = 'sending' AND call_at <= ?", now.getTime() - 60_000)) {
      if (!row.call_id) { await dispatch(row, row.attempts, now); continue; }
      try {
        const reply = await status(row.call_id);
        if (["succeeded", "failed", "unknown"].includes(reply.status)) result({ ...reply, status: reply.status as CallResult["status"] }, now);
      } catch { finish(row, { outcome: "uncertain", error: "Delivery call lost; receipt unknown" }, row.attempts, now); }
    }
  }
  function digest(now: Date) {
    const settings = store.settings(), key = `digest:${localDayKey(now, settings.timezone)}`;
    if (!isDigestDue({ ...settings, now, lastDigestDay: null }) || routeNotification("now", { ...settings, dailyCap: 1, sentToday: 0, now, urgent: false }) !== "send" || store.byKey(key)) return;
    const due = store.rows("SELECT * FROM notifications WHERE status = 'folded' AND digest_id IS NULL ORDER BY created_at, id").filter(row => foldedBeforeDigest(new Date(row.created_at), { ...settings, now }));
    const composed = composeDigest(due.map(row => ({ title: row.title, body: row.body, moduleTitle: row.app })), { dayLabel: localDayKey(now, settings.timezone) });
    if (!composed) return;
    const row = store.insert({ key, module_id: null, app: null, session_id: null, approval_id: null, scoped: 0, level: "now", web: 0, responds: 0, status: "queued",
      title: composed.title, body: composed.body.slice(0, 2000), recipient: null, link: `${base}/today`, created_at: now.getTime() });
    for (const folded of due) store.update(folded.id, { digest_id: row.id });
  }
  function configure(args: Args) {
    const at = Date.parse(String(args.at));
    if (!Number.isFinite(at)) return { error: "invalid", message: "at must be a time" };
    if (Number(store.get("settings_at") ?? 0) > at) return { ignored: true };
    const settings: Settings = { dailyCap: Number(args["daily-cap"]), timezone: String(args.timezone), digestAt: String(args["digest-at"]),
      quietHours: text(args["quiet-start"]) && text(args["quiet-end"]) ? { start: String(args["quiet-start"]), end: String(args["quiet-end"]) } : null };
    if (!validSettings(settings)) return { error: "invalid", message: "Invalid notification settings" };
    store.set("settings", JSON.stringify(settings)); store.set("settings_at", String(at));
    return { settings };
  }
  function importRows(args: Args) {
    let rows: unknown;
    try { rows = JSON.parse(String(args.rows)); } catch { return { error: "invalid", message: "rows must be a JSON array" }; }
    if (!Array.isArray(rows)) return { error: "invalid", message: "rows must be a JSON array" };
    let imported = 0;
    for (const item of rows as unknown[]) {
      const raw = item as Record<string, unknown> | null;
      if (!raw || typeof raw !== "object" || typeof raw.idempotencyKey !== "string" || typeof raw.title !== "string") continue;
      // A send whose lease was still held may have reached the channel: keep it out of automatic resends.
      const leased = raw.status === "queued" && Boolean(raw.leaseToken);
      const time = (value: unknown) => typeof value === "string" ? Date.parse(value) : null;
      if (store.byKey(raw.idempotencyKey)) continue;
      store.insert({ id: String(raw.id), key: raw.idempotencyKey, module_id: text(raw.moduleId), app: text(raw.app), session_id: text(raw.sessionId), approval_id: text(raw.approvalId), scoped: raw.moduleId && raw.approvalId ? 1 : 0,
        level: raw.level as Level, web: raw.level === "web" ? 1 : 0, responds: raw.idempotencyKey.startsWith(RESPONSE_KEY_PREFIX) ? 1 : 0, channel: String(raw.channel ?? "in_app"),
        status: leased ? "uncertain" : String(raw.status), title: raw.title, body: String(raw.body ?? ""), recipient: text(raw.recipient), link: text(raw.link),
        created_at: time(raw.createdAt) ?? Date.now(), attempts: Number(raw.attempts ?? 0), last_error: leased ? "Delivery lease held when notifications moved to the notify module; receipt unknown" : text(raw.lastError),
        sent_at: time(raw.sentAt), receipt_ref: text(raw.receiptRef), feedback: text(raw.feedback), next_attempt_at: time(raw.nextAttemptAt) });
      imported++;
    }
    return { imported };
  }
  /** One routed tool call. Business errors are results, never throws: a throw counts as a module failure. */
  function handle(tool: string, args: Args, caller: Caller, now: Date) {
    switch (tool) {
      case "send": return send(args, caller, now);
      case "withdraw": {
        const key = String(args.key), row = store.byKey(key);
        // A tombstone also drops a send that arrives later with the same key.
        if (!row) store.insert({ key, module_id: null, app: null, session_id: null, approval_id: null, scoped: 0, level: "web", web: 1, responds: 0, status: "suppressed", title: "", body: "", recipient: null, link: null, created_at: now.getTime() });
        else if (["queued", "folded"].includes(row.status)) store.update(row.id, { status: "suppressed" });
        return { withdrawn: !row || ["queued", "folded"].includes(row.status) };
      }
      case "channel": {
        const at = Date.parse(String(args.at)), previous = store.get(`channel:${String(args.channel)}`);
        if (!Number.isFinite(at)) return { error: "invalid", message: "at must be a time" };
        if (previous && (JSON.parse(previous) as { at: number }).at > at) return { ignored: true };
        store.set(`channel:${String(args.channel)}`, JSON.stringify({ ready: args.ready === true, at }));
        return { ready: args.ready === true };
      }
      case "list": {
        const limit = Math.max(1, Math.min(50, Math.trunc(Number(args.limit)) || 20));
        return { items: store.rows("SELECT * FROM notifications WHERE status != 'suppressed' ORDER BY created_at DESC, id DESC LIMIT ?", limit).map(view) };
      }
      case "status": {
        const settings = store.settings(), day = localDayKey(now, settings.timezone);
        const sent = store.rows("SELECT * FROM notifications WHERE channel = ? AND responds = 0 AND sent_at >= ?", QQ, now.getTime() - 2 * DAY).filter(row => localDayKey(new Date(row.sent_at!), settings.timezone) === day).length;
        const count = (statuses: string) => (store.db.query(`SELECT COUNT(*) AS n FROM notifications WHERE status IN (${statuses})`).get() as { n: number }).n;
        return { chat: { channel: store.get(`channel:${QQ}`) ? QQ : "in_app", bound: channelReady(QQ), sentToday: sent }, queued: count("'queued', 'sending'"), failed: count("'failed', 'uncertain'") };
      }
      case "feedback": {
        const row = store.byId(String(args.id));
        if (!row || row.status === "suppressed") return { error: "not_found", message: "Notification not found" };
        store.update(row.id, { feedback: String(args.feedback) });
        return { notification: view(store.byId(row.id)!) };
      }
      case "retry": {
        const row = store.byId(String(args.id));
        if (!row || row.status === "suppressed") return { error: "not_found", message: "Notification not found" };
        if (row.status !== "failed") return { error: "conflict", message: "Only failed notifications may be retried" };
        store.update(row.id, { status: "queued", attempts: 0, next_attempt_at: now.getTime(), last_error: null, call_id: null });
        return { notification: view(store.byId(row.id)!) };
      }
      case "configure": return configure(args);
      case "import": return importRows(args);
      default: throw new Error(`Unknown tool ${tool}`);
    }
  }
  return {
    handle, result,
    async tick(now: Date) { await recover(now); digest(now); await deliverDue(now); },
  };
}
