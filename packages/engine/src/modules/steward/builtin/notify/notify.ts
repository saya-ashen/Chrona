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
type ImportedArgs = Args & { idempotencyKey: string; title: string };
type Channel = { module: string; moduleId: string; tool: string; ready: boolean; at: number };
const text = (value: unknown) => typeof value === "string" && value.length ? value : null;
const iso = (ms: number | null) => ms === null ? null : new Date(ms).toISOString();
const DAY = 86_400_000;

class NotifyRuntime {
  private readonly store: Store;
  private readonly base: string;
  private readonly callPort: Ports["call"];
  private readonly statusPort: Ports["status"];
  constructor({ store, publicUrl, call, status }: Ports) {
    this.store = store;
    this.base = (publicUrl ?? "").replace(/\/$/, "");
    this.callPort = call;
    this.statusPort = status;
  }
  /** Old readiness-only records are not registrations: wait for their owner to register again. */
  private channels() {
    return (this.store.db.query("SELECT key, value FROM kv WHERE key LIKE 'channel:%' ORDER BY key").all() as { key: string; value: string }[])
      .map(row => ({ name: row.key.slice(8), ...JSON.parse(row.value) as Channel }))
      .filter(channel => channel.module && channel.moduleId && channel.tool);
  }
  private channelFor(row: Row) {
    const channels = this.channels();
    return row.channel !== "in_app" ? channels.find(channel => channel.name === row.channel) : channels.find(channel => channel.ready);
  }
  private view(row: Row) {
    return { id: row.id, moduleId: row.module_id, sessionId: row.session_id, level: row.level, channel: row.channel, status: row.status === "sending" ? "queued" : row.status,
      title: row.title, body: row.body, link: row.link, attempts: row.attempts, lastError: row.last_error, createdAt: iso(row.created_at)!, sentAt: iso(row.sent_at), feedback: row.feedback };
  }
  private sentToday(now: Date, settings: Settings) {
    const day = localDayKey(now, settings.timezone);
    return this.store.rows("SELECT * FROM notifications WHERE level = 'now' AND responds = 0 AND key NOT LIKE 'digest:%' AND (sent_at >= ? OR status IN ('queued', 'sending'))", now.getTime() - 2 * DAY)
      .filter(row => localDayKey(new Date(row.sent_at ?? row.created_at), settings.timezone) === day).length;
  }
  private sendKey(args: Args, caller: Caller) { return caller.kind === "module" ? `module:${caller.moduleId}:${String(args.key)}` : String(args.key); }
  private sender(caller: Caller, args: Args) {
    const trusted = caller.kind === "kernel";
    return { trusted, moduleId: caller.kind === "module" ? caller.moduleId : trusted ? text(args.module) : null,
      app: caller.kind === "module" ? caller.module : trusted ? text(args.app) : null };
  }
  private requestedLevel(args: Args, moduleId: string | null, responds: boolean, settings: Settings, now: Date): { requested: Level; route: "send" | "fold" | "web" } {
    const negative = moduleId ? (this.store.db.query("SELECT COUNT(*) AS n FROM notifications WHERE module_id = ? AND feedback = 'not_useful' AND created_at >= ?").get(moduleId, now.getTime() - 30 * DAY) as { n: number }).n : 0;
    const requested = args.level as Level;
    const level: Level = !responds && negative >= 2 && requested === "now" ? "digest" : requested;
    return { requested, route: routeNotification(level, { ...settings, now, urgent: args.urgent === true, sentToday: this.sentToday(now, settings), responds }) };
  }
  private send(args: Args, caller: Caller, now: Date) {
    // A module's keys are its own: another module cannot pre-empt or suppress them.
    const key = this.sendKey(args, caller), existing = this.store.byKey(key);
    if (existing) return { id: existing.id, status: this.view(existing).status, duplicate: true };
    const { trusted, moduleId, app } = this.sender(caller, args), responds = args.responds === true || key.startsWith(RESPONSE_KEY_PREFIX);
    const settings = this.store.settings(), { requested, route } = this.requestedLevel(args, moduleId, responds, settings, now), session = text(args.session);
    const row = this.store.insert({ key, module_id: moduleId, app, session_id: session, approval_id: trusted ? text(args.approval) : null, scoped: args.scoped === true ? 1 : 0,
      level: requested, web: route === "web" ? 1 : 0, responds: responds ? 1 : 0, status: route === "fold" ? "folded" : "queued",
      title: String(args.title).slice(0, 200), body: String(args.body).slice(0, 4000), recipient: text(args.recipient),
      link: session ? `${this.base}/sessions/${session}` : moduleId ? `${this.base}/apps/${moduleId}` : null, created_at: now.getTime() });
    return { id: row.id, status: this.view(row).status, duplicate: false };
  }
  private finish(row: Row, outcome: DeliveryOutcome, attempts: number, now: Date) {
    const next = deliveryStatus(outcome, attempts);
    this.store.update(row.id, { status: next, call_id: null, sent_at: outcome.outcome === "accepted" ? now.getTime() : null, receipt_ref: outcome.outcome === "accepted" ? outcome.receiptRef : null,
      last_error: outcome.outcome === "accepted" ? null : outcome.error.slice(0, 500), next_attempt_at: next === "queued" ? now.getTime() + retryDelayMs(attempts) : null });
  }
  private async dispatch(row: Row, attempts: number, now: Date) {
    const channel = this.channelFor(row);
    if (!channel?.ready) return;
    const args: Args = { key: row.key, title: row.title, body: row.body, ...(row.link ? { link: row.link } : {}), ...(row.recipient ? { recipient: row.recipient } : {}),
      ...(row.approval_id ? { approval: row.approval_id, scoped: row.scoped === 1 } : {}) };
    try {
      // Async with the attempt in the key: a repeat after a crash returns the same call instead of sending twice.
      const reply = await this.callPort(`${channel.module}.${channel.tool}`, args, { mode: "async", key: `deliver:${row.id}:${attempts}`, reply: true });
      this.store.update(row.id, { call_id: reply.callId });
      if (["succeeded", "failed", "unknown"].includes(reply.status)) this.result({ ...reply, status: reply.status as CallResult["status"] }, now);
    } catch (error) {
      this.finish(this.store.byId(row.id)!, { outcome: "rejected", retryable: true, error: `Channel unavailable: ${error instanceof Error ? error.message : String(error)}` }, attempts, now);
    }
  }
  private digestBlocked(row: Row, settings: Settings, now: Date) {
    return row.key.startsWith("digest:") && routeNotification("now", { ...settings, dailyCap: 1, sentToday: 0, now, urgent: false }) !== "send";
  }
  private deliverInApp(row: Row, attempts: number, now: Date) {
    this.store.update(row.id, { channel: "in_app", status: "sent", attempts, sent_at: now.getTime(), receipt_ref: `in_app:${row.key}`, last_error: null, next_attempt_at: null });
  }
  private async deliverDue(now: Date) {
    const settings = this.store.settings();
    for (const row of this.store.rows("SELECT * FROM notifications WHERE status = 'queued' AND next_attempt_at <= ? ORDER BY created_at, id LIMIT 50", now.getTime())) {
      if (this.digestBlocked(row, settings, now)) continue;
      const attempts = row.attempts + 1;
      // The channel is chosen when sending: no registered, ready channel falls back to the web.
      const channel = this.channelFor(row);
      if (row.web || !channel?.ready) { this.deliverInApp(row, attempts, now); continue; }
      this.store.update(row.id, { channel: channel.name, status: "sending", attempts, call_id: null, call_at: now.getTime() });
      await this.dispatch({ ...row, channel: channel.name }, attempts, now);
    }
  }
  /** A channel module's answer (or the kernel's verdict when it never answered). */
  result(event: CallResult, now: Date) {
    const row = this.store.byCall(event.callId);
    if (!row || row.status !== "sending") return;
    const output = event.output as DeliveryOutcome | undefined;
    const valid = event.status === "succeeded" && output && typeof output === "object" && ["accepted", "rejected", "uncertain"].includes(output.outcome);
    // The channel may have reached the transport before failing: never resend an unknown outcome.
    this.finish(row, valid ? output : { outcome: "uncertain", error: event.error ?? "Channel returned no delivery outcome; receipt unknown" }, row.attempts, now);
  }
  private async recover(now: Date) {
    for (const row of this.store.rows("SELECT * FROM notifications WHERE status = 'sending' AND call_at <= ?", now.getTime() - 60_000)) {
      if (!row.call_id) { await this.dispatch(row, row.attempts, now); continue; }
      try {
        const reply = await this.statusPort(row.call_id);
        if (["succeeded", "failed", "unknown"].includes(reply.status)) this.result({ ...reply, status: reply.status as CallResult["status"] }, now);
      } catch { this.finish(row, { outcome: "uncertain", error: "Delivery call lost; receipt unknown" }, row.attempts, now); }
    }
  }
  private digest(now: Date) {
    const settings = this.store.settings(), key = `digest:${localDayKey(now, settings.timezone)}`;
    if (!isDigestDue({ ...settings, now, lastDigestDay: null }) || routeNotification("now", { ...settings, dailyCap: 1, sentToday: 0, now, urgent: false }) !== "send" || this.store.byKey(key)) return;
    const due = this.store.rows("SELECT * FROM notifications WHERE status = 'folded' AND digest_id IS NULL ORDER BY created_at, id").filter(row => foldedBeforeDigest(new Date(row.created_at), { ...settings, now }));
    const composed = composeDigest(due.map(row => ({ title: row.title, body: row.body, moduleTitle: row.app })), { dayLabel: localDayKey(now, settings.timezone) });
    if (!composed) return;
    const row = this.store.insert({ key, module_id: null, app: null, session_id: null, approval_id: null, scoped: 0, level: "now", web: 0, responds: 0, status: "queued",
      title: composed.title, body: composed.body.slice(0, 2000), recipient: null, link: `${this.base}/today`, created_at: now.getTime() });
    for (const folded of due) this.store.update(folded.id, { digest_id: row.id });
  }
  private configure(args: Args) {
    const at = Date.parse(String(args.at));
    if (!Number.isFinite(at)) return { error: "invalid", message: "at must be a time" };
    if (Number(this.store.get("settings_at") ?? 0) > at) return { ignored: true };
    const settings: Settings = { dailyCap: Number(args["daily-cap"]), timezone: String(args.timezone), digestAt: String(args["digest-at"]),
      quietHours: text(args["quiet-start"]) && text(args["quiet-end"]) ? { start: String(args["quiet-start"]), end: String(args["quiet-end"]) } : null };
    if (!validSettings(settings)) return { error: "invalid", message: "Invalid notification settings" };
    this.store.set("settings", JSON.stringify(settings)); this.store.set("settings_at", String(at));
    return { settings };
  }
  private insertImported(raw: ImportedArgs, leased: boolean) {
    const time = (value: unknown) => typeof value === "string" ? Date.parse(value) : null;
    this.store.insert({ id: String(raw.id), key: raw.idempotencyKey, module_id: text(raw.moduleId), app: text(raw.app), session_id: text(raw.sessionId), approval_id: text(raw.approvalId), scoped: raw.moduleId && raw.approvalId ? 1 : 0,
      level: raw.level as Level, web: raw.level === "web" ? 1 : 0, responds: raw.idempotencyKey.startsWith(RESPONSE_KEY_PREFIX) ? 1 : 0, channel: String(raw.channel ?? "in_app"),
      status: leased ? "uncertain" : String(raw.status), title: raw.title, body: String(raw.body ?? ""), recipient: text(raw.recipient), link: text(raw.link),
      created_at: time(raw.createdAt) ?? Date.now(), attempts: Number(raw.attempts ?? 0), last_error: leased ? "Delivery lease held when notifications moved to the notify module; receipt unknown" : text(raw.lastError),
      sent_at: time(raw.sentAt), receipt_ref: text(raw.receiptRef), feedback: text(raw.feedback), next_attempt_at: time(raw.nextAttemptAt) });
  }
  private importRow(raw: Record<string, unknown>) {
    if (typeof raw.idempotencyKey !== "string") return false;
    if (typeof raw.title !== "string") return false;
    if (this.store.byKey(raw.idempotencyKey)) return false;
    // A send whose lease was still held may have reached the channel: keep it out of automatic resends.
    const imported: ImportedArgs = { ...raw, idempotencyKey: raw.idempotencyKey, title: raw.title };
    this.insertImported(imported, raw.status === "queued" && Boolean(raw.leaseToken));
    return true;
  }
  private importRows(args: Args) {
    let rows: unknown;
    try { rows = JSON.parse(String(args.rows)); } catch { return { error: "invalid", message: "rows must be a JSON array" }; }
    if (!Array.isArray(rows)) return { error: "invalid", message: "rows must be a JSON array" };
    let imported = 0;
    for (const item of rows) if (item && typeof item === "object" && this.importRow(item as Record<string, unknown>)) imported++;
    return { imported };
  }
  private withdraw(args: Args, now: Date) {
    const key = String(args.key), row = this.store.byKey(key);
    // A tombstone also drops a send that arrives later with the same key.
    if (!row) this.store.insert({ key, module_id: null, app: null, session_id: null, approval_id: null, scoped: 0, level: "web", web: 1, responds: 0, status: "suppressed", title: "", body: "", recipient: null, link: null, created_at: now.getTime() });
    else if (["queued", "folded"].includes(row.status)) this.store.update(row.id, { status: "suppressed" });
    return { withdrawn: !row || ["queued", "folded"].includes(row.status) };
  }
  private channel(args: Args, caller: Caller) {
    // Build smoke probes have no module caller.
    if (caller.kind !== "module") return { ignored: true };
    const name = text(args.channel), tool = text(args.tool), at = Date.parse(String(args.at));
    if (!name || name === "in_app" || !/^[a-z][a-z0-9_-]{0,63}$/.test(name) || !tool || !/^[a-z][a-z0-9-]{0,63}$/.test(tool)) return { error: "invalid", message: "channel and local delivery tool are required" };
    if (!Number.isFinite(at)) return { error: "invalid", message: "at must be a time" };
    const value = this.store.get(`channel:${name}`), previous = value ? JSON.parse(value) as Partial<Channel> : null;
    if (previous?.moduleId && previous.moduleId !== caller.moduleId) return { error: "forbidden", message: "Channel belongs to another module" };
    if (previous?.moduleId && previous.at! > at) return { ignored: true };
    this.store.set(`channel:${name}`, JSON.stringify({ module: caller.module, moduleId: caller.moduleId, tool, ready: args.ready === true, at } satisfies Channel));
    return { ready: args.ready === true };
  }
  private list(args: Args) {
    const limit = Math.max(1, Math.min(50, Math.trunc(Number(args.limit)) || 20));
    return { items: this.store.rows("SELECT * FROM notifications WHERE status != 'suppressed' ORDER BY created_at DESC, id DESC LIMIT ?", limit).map(row => this.view(row)) };
  }
  private status(now: Date) {
    const settings = this.store.settings(), day = localDayKey(now, settings.timezone);
    const channels = this.channels(), channel = channels.find(channel => channel.ready) ?? channels[0];
    const sent = this.store.rows("SELECT * FROM notifications WHERE channel = ? AND responds = 0 AND sent_at >= ?", channel?.name ?? "in_app", now.getTime() - 2 * DAY).filter(row => localDayKey(new Date(row.sent_at!), settings.timezone) === day).length;
    const count = (statuses: string) => (this.store.db.query(`SELECT COUNT(*) AS n FROM notifications WHERE status IN (${statuses})`).get() as { n: number }).n;
    return { chat: { channel: channel?.name ?? "in_app", bound: channel?.ready ?? false, sentToday: sent }, queued: count("'queued', 'sending'"), failed: count("'failed', 'uncertain'") };
  }
  private feedback(args: Args) {
    const row = this.store.byId(String(args.id));
    if (!row || row.status === "suppressed") return { error: "not_found", message: "Notification not found" };
    this.store.update(row.id, { feedback: String(args.feedback) });
    return { notification: this.view(this.store.byId(row.id)!) };
  }
  private retry(args: Args, now: Date) {
    const row = this.store.byId(String(args.id));
    if (!row || row.status === "suppressed") return { error: "not_found", message: "Notification not found" };
    if (row.status !== "failed") return { error: "conflict", message: "Only failed notifications may be retried" };
    this.store.update(row.id, { status: "queued", attempts: 0, next_attempt_at: now.getTime(), last_error: null, call_id: null });
    return { notification: this.view(this.store.byId(row.id)!) };
  }
  /** One routed tool call. Business errors are results, never throws: a throw counts as a module failure. */
  handle(tool: string, args: Args, caller: Caller, now: Date) {
    const handlers: Record<string, () => unknown> = {
      send: () => this.send(args, caller, now), withdraw: () => this.withdraw(args, now), channel: () => this.channel(args, caller), list: () => this.list(args),
      status: () => this.status(now), feedback: () => this.feedback(args), retry: () => this.retry(args, now), configure: () => this.configure(args), import: () => this.importRows(args),
    };
    if (!Object.hasOwn(handlers, tool)) throw new Error(`Unknown tool ${tool}`);
    return handlers[tool]!();
  }
  async tick(now: Date) { await this.recover(now); this.digest(now); await this.deliverDue(now); }
}

/** Budget, registered channel callbacks and delivery receipts. */
export function createNotify(ports: Ports) {
  const runtime = new NotifyRuntime(ports);
  return { handle: runtime.handle.bind(runtime), result: runtime.result.bind(runtime), tick: runtime.tick.bind(runtime) };
}
