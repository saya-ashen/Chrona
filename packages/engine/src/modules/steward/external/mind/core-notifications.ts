import { Database } from "bun:sqlite";
import { chmodSync, existsSync, lstatSync } from "node:fs";
import { join, dirname } from "node:path";
import { CoreMindStore, coreDigest } from "./core-store";
import { scopeCovers } from "./core-service";
import type { CoreCall } from "./core-execution";
import type { CoreState, Pursuit } from "./core-types";

export const CORE_NOTIFICATIONS_FILE = "mind.sqlite";
export type ResolveNotify = () => string | undefined | Promise<string | undefined>;
type Pin = { pursuitId: string; revision: number; visibility: number; digest: string; releaseDigest: string; owned: boolean };
type Event = { key: string; pin: string; intent: string | null; digest_only: number };
type Intent = { key: string; members: string; level: "now" | "digest"; module_id: string; receipt: string | null; notify_status: string | null; created_at: string; request_digest: string | null };
const DAY = 86_400_000;
const stamp = (now?: string | Date) => {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (!Number.isFinite(d.getTime())) throw new Error("Invalid notification time");
  return d.toISOString();
};
function clock(state: CoreState, now: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: state.settings.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const parse = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
  const start = parse(state.settings.quietStart), end = parse(state.settings.quietEnd);
  return { day: `${get("year")}-${get("month")}-${get("day")}`, quiet: start === end ? false : start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end };
}
const enabled = (s: CoreState) => s.settings.enabled && s.settings.notifyEnabled && !s.settings.restoreBlocked;
/** The hash includes current evidence/understanding versions, but never stores their prose. */
function pinFor(p: Pursuit, s: CoreState): Pin {
  const evidence = p.evidenceRefs.map(id => s.evidence.find(e => e.id === id) ?? null);
  const understandings = p.understandingRefs.map(id => s.understandings.find(u => u.id === id) ?? null);
  const released = { ...p, revision: 0, updatedAt: "" };
  delete released.currentActor;
  return { pursuitId: p.id, revision: p.revision, visibility: s.visibilityRevision, owned: !!p.currentActor,
    digest: coreDigest([p, evidence, understandings]), releaseDigest: coreDigest([released, evidence, understandings]) };
}
function outcome(p: Pursuit) {
  // Responsibility release increments revision without creating a new user-visible outcome.
  return `mind-notification:${coreDigest([p.id, p.goal, p.status, p.verification ?? null, p.artifactRefs, p.nextStep ?? null, p.waitReason ?? null])}`;
}
function reason(p: Pursuit, s: CoreState, now: string): string | undefined {
  if (p.suppression && p.suppression.until > now) return p.suppression.reason === "rejected" ? "topic-rejected-30-days" : "repeated-not-useful";
  if (p.paused || p.status === "ended" || !p.goal || p.currentActor?.stopRequested) return "paused-or-withdrawn";
  if (!p.verification || !["done", "waiting", "active"].includes(p.status) || (!p.artifactRefs.length && !p.nextStep && !p.waitReason)) return "no-verified-outcome";
  // A verified result can outlive a source gap or consent change. Check current coverage
  // at every dispatch, including retries of an unresolved Notify effect.
  const available = (id: string) => {
    const e = s.evidence.find(e => e.id === id);
    return !!e && !e.retractedAt && !e.expiredAt && (e.sourceIdentity === "owner" || e.sourceIdentity === "mind-owner" ||
      s.checkpoints.some(cp => cp.sourceIdentity === e.sourceIdentity && cp.epoch === e.epoch && cp.scopeRevision === e.scopeRevision && cp.coverage.complete && !cp.coverage.gap));
  };
  if (!p.evidenceRefs.length || p.evidenceRefs.some(id => !available(id))) return "evidence-unavailable";
  if (p.understandingRefs.some(id => { const u = s.understandings.find(u => u.id === id); return !u || u.status !== "active" || [...u.supportingRefs, ...u.opposingRefs].some(ref => !available(ref)); })) return "understanding-unavailable";
  if (s.candidates.some(c => c.state === "applied" && c.pursuitId === p.id && c.runRef === p.verification!.runRef && c.actor === "chat")) return "answered-in-chat";
  const feedback = s.feedback.filter(f => {
    const target = f.targetKind === "pursuit" ? s.pursuits.find(v => v.id === f.targetId) : s.understandings.find(v => v.id === f.targetId);
    return target && (f.targetId === p.id || (f.targetKind === "pursuit" && (target as Pursuit).semanticKey === p.semanticKey) || p.understandingRefs.includes(f.targetId)) && scopeCovers(f.scope, p.scope);
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const restart = feedback.find(f => f.value === "restart");
  const applicable = feedback.filter(f => !restart || f.createdAt > restart.createdAt);
  if (applicable.some(f => f.value === "reject" && (f.suppressedUntil ?? new Date(Date.parse(f.createdAt) + 30 * DAY).toISOString()) > now)) return "topic-rejected-30-days";
  if (applicable.filter(f => f.value === "not-useful").length >= 2 && applicable[0]?.value !== "useful") return "repeated-not-useful";
}

/** Runtime-owned adapter. No access or authority is accepted from tool JSON. Web outcomes remain in the core store. */
export class CoreNotifications {
  readonly path: string;
  private readonly db: Database;
  private running?: Promise<ReturnType<CoreNotifications["view"]>>;
  private closed = false;
  constructor(private readonly store: CoreMindStore, private readonly call: CoreCall, private readonly resolveNotify: ResolveNotify) {
    this.path = join(dirname(store.path), CORE_NOTIFICATIONS_FILE);
    if (existsSync(this.path) && (!lstatSync(this.path).isFile() || lstatSync(this.path).isSymbolicLink())) throw new Error("Mind notification database must be a regular file");
    this.db = new Database(this.path, { create: true, strict: true });
    chmodSync(this.path, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS notification_events(key TEXT PRIMARY KEY, pin TEXT NOT NULL, intent TEXT, digest_only INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS notification_intents(key TEXT PRIMARY KEY, members TEXT NOT NULL, level TEXT NOT NULL, module_id TEXT NOT NULL, receipt TEXT, notify_status TEXT, created_at TEXT NOT NULL, request_digest TEXT);
      CREATE TABLE IF NOT EXISTS notification_budget(day TEXT NOT NULL, key TEXT NOT NULL, level TEXT NOT NULL, PRIMARY KEY(day,key));`);
  }
  private events() { return this.db.query<Event, []>("SELECT * FROM notification_events ORDER BY rowid").all(); }
  private intents() { return this.db.query<Intent, []>("SELECT * FROM notification_intents ORDER BY rowid").all(); }
  private current(event: Event, s: CoreState, now: string): Pursuit | undefined {
    const pin = JSON.parse(event.pin) as Pin, p = s.pursuits.find(p => p.id === pin.pursuitId);
    return p && !reason(p, s, now) && coreDigest(pinFor(p, s)) === coreDigest(pin) ? p : undefined;
  }
  view(now?: string | Date) {
    const at = stamp(now), state = this.store.read(), time = clock(state, at), intents = this.intents(), events = this.events();
    return { enabled: enabled(state), timezone: state.settings.timezone, quiet: time.quiet, day: time.day,
      pending: events.filter(e => !e.intent && this.current(e, state, at)).length,
      stalePending: events.filter(e => !e.intent && !this.current(e, state, at)).length,
      unresolved: intents.filter(i => !i.receipt).length,
      receipts: intents.filter(i => i.receipt).slice(-50).map(i => ({ key: i.key, receiptId: i.receipt!, notifyStatus: i.notify_status, delivery: "unknown" as const })),
      suppressed: state.pursuits.flatMap(p => { const r = reason(p, state, at); return r ? [{ pursuitId: p.id, reason: r }] : []; }).slice(0, 50),
      held: intents.filter(i => !i.receipt && (JSON.parse(i.members) as string[]).some(key => { const e = events.find(e => e.key === key); return !e || !this.current(e, state, at); })).map(i => i.key).slice(0, 50) };
  }
  sync(now?: string | Date): Promise<ReturnType<CoreNotifications["view"]>> {
    if (this.closed) return Promise.reject(new Error("Mind notifications are closed"));
    if (this.running) return this.running;
    this.running = this.perform(stamp(now), now === undefined).finally(() => { this.running = undefined; });
    return this.running;
  }
  private reserve(day: string, key: string, level: "now" | "digest") {
    return this.db.transaction(() => {
      if (this.db.query("SELECT 1 FROM notification_budget WHERE day=? AND key=?").get(day, key)) return true;
      const count = this.db.query<{ n: number }, [string, string]>("SELECT count(*) AS n FROM notification_budget WHERE day=? AND level=?").get(day, level)!.n;
      if (count >= (level === "now" ? 5 : 1)) return false;
      this.db.query("INSERT INTO notification_budget VALUES(?,?,?)").run(day, key, level); return true;
    }).immediate();
  }
  private prepare(members: Event[], level: "now" | "digest", moduleId: string, now: string): Intent | undefined {
    const keys = members.map(e => e.key), key = level === "now" ? keys[0]! : `mind-digest:${coreDigest(keys)}`;
    return this.db.transaction(() => {
      // Concurrent adapters must not assign an outcome to two different digest identities.
      for (const member of members) {
        const current = this.db.query<Event, [string]>("SELECT * FROM notification_events WHERE key=?").get(member.key);
        if (!current || (current.intent && current.intent !== key)) return undefined;
      }
      this.db.query("INSERT OR IGNORE INTO notification_intents(key,members,level,module_id,created_at) VALUES(?,?,?,?,?)").run(key, JSON.stringify(keys), level, moduleId, now);
      for (const e of members) this.db.query("UPDATE notification_events SET intent=? WHERE key=? AND intent IS NULL").run(key, e.key);
      return this.db.query<Intent, [string]>("SELECT * FROM notification_intents WHERE key=?").get(key)!;
    }).immediate();
  }
  private async dispatch(intent: Intent | undefined, now: string): Promise<void> {
    if (!intent) return;
    const state = this.store.read(), time = clock(state, now);
    if (this.closed || !enabled(state) || time.quiet) return;
    const events = this.events(), members = (JSON.parse(intent.members) as string[]).map(key => events.find(e => e.key === key));
    if (members.some(e => !e || !this.current(e, state, now))) return;
    const pursuits = members.map(e => this.current(e!, state, now)!);
    // Only current-state summaries enter Notify. There are no historical bodies in this database.
    const body = pursuits.map(p => `${p.goal.slice(0, 300)}\n${(p.nextStep ?? p.waitReason ?? (p.status === "done" ? "已核对完成" : "已有可查看的成果")).slice(0, 300)}${p.artifactRefs.length ? `\n成果：${p.artifactRefs.slice(0, 3).map(r => r.slice(0, 200)).join("、")}` : ""}`).join("\n\n").slice(0, 4000);
    const args = { key: intent.key, level: intent.level, title: intent.level === "digest" ? "Mind 进展汇总" : "Mind 有新的进展", body, format: "text", responds: false, urgent: false };
    const requestDigest = coreDigest(args);
    const exact = this.db.transaction(() => {
      const row = this.db.query<Intent, [string]>("SELECT * FROM notification_intents WHERE key=?").get(intent.key)!;
      if (row.request_digest && row.request_digest !== requestDigest) return false;
      this.db.query("UPDATE notification_intents SET request_digest=? WHERE key=?").run(requestDigest, intent.key); return true;
    }).immediate();
    if (!exact || !this.reserve(time.day, intent.key, intent.level)) return;
    let phase = "notify-call";
    try {
      const result = await this.call({ moduleId: intent.module_id, tool: "send" }, args, { key: intent.key });
      phase = "invalid-notify-receipt";
      const receipt = result as { id?: unknown; status?: unknown; duplicate?: unknown } | null;
      if (!receipt || typeof receipt.id !== "string" || !receipt.id || typeof receipt.status !== "string" || typeof receipt.duplicate !== "boolean") throw new Error("Notify send returned no valid receipt");
      phase = "receipt-persistence";
      this.db.query("UPDATE notification_intents SET receipt=?,notify_status=? WHERE key=?").run(receipt.id, receipt.status, intent.key);
    } catch (error) {
      // Provider errors can contain request bodies: log the category, never copied private text.
      console.error(JSON.stringify({ component: "mind-notifications", event: "send_unresolved", key: intent.key, phase, error: error instanceof Error ? error.name : typeof error }));
    }
  }
  private async perform(now: string, liveClock: boolean) {
    const currentTime = () => liveClock ? stamp() : now;
    let state = this.store.read(), time = clock(state, now);
    if (!enabled(state)) return this.view(now);
    const events = this.events();
    for (const p of state.pursuits) {
      if (reason(p, state, now)) continue;
      // An unresolved effect owns this pursuit until its original receipt is known.
      if (events.some(e => { const pin = JSON.parse(e.pin) as Pin; return pin.pursuitId === p.id && e.intent && this.intents().some(i => i.key === e.intent && !i.receipt); })) continue;
      const key = outcome(p), pin = pinFor(p, state), prior = events.find(e => e.key === key);
      if (prior && !prior.intent) {
        const old = JSON.parse(prior.pin) as Pin;
        // A reconciled ownership release changes no source, artifact or visible result.
        // Only an unattempted intent may follow that transition; unknown effects stay frozen.
        if (old.owned && !pin.owned && old.visibility === pin.visibility && old.releaseDigest === pin.releaseDigest) {
          this.db.query("UPDATE notification_events SET pin=? WHERE key=? AND intent IS NULL").run(JSON.stringify(pin), key);
        }
      }
      this.db.query("INSERT OR IGNORE INTO notification_events VALUES(?,?,NULL,?)").run(key, JSON.stringify(pin), time.quiet ? 1 : 0);
    }
    if (time.quiet) return this.view(now);
    // Recovery uses the persisted module identity even if directory resolution is unavailable.
    const unresolved = this.intents().filter(i => !i.receipt);
    for (const intent of unresolved.slice(0, 6)) await this.dispatch(intent, currentTime());
    const moduleId = await this.resolveNotify();
    if (!moduleId || this.closed) return this.view(now);
    // Resolution is asynchronous; settings, feedback, visibility and wall clock may have changed.
    now = currentTime();
    state = this.store.read(); time = clock(state, now);
    if (!enabled(state) || time.quiet) return this.view(now);
    let ready = this.events().filter(e => !e.intent && this.current(e, state, now));
    // A digest holds at most three outcomes, keeping each summary useful within Notify's body limit.
    for (const e of ready.filter(e => !e.digest_only).slice(0, 5)) {
      const count = this.db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM notification_budget WHERE day=? AND level='now'").get(time.day)!.n;
      if (count >= 5) break;
      await this.dispatch(this.prepare([e], "now", moduleId, currentTime()), currentTime());
    }
    state = this.store.read();
    ready = this.events().filter(e => !e.intent && this.current(e, state, now));
    const digestCount = this.db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM notification_budget WHERE day=? AND level='digest'").get(time.day)!.n;
    if (ready.length && digestCount < 1) await this.dispatch(this.prepare(ready.slice(0, 3), "digest", moduleId, currentTime()), currentTime());
    // Daily counters are transient; keys and unresolved effects remain durable without a lifetime cap.
    this.db.query("DELETE FROM notification_budget WHERE day<?").run(new Date(Date.parse(now) - 35 * DAY).toISOString().slice(0, 10));
    return this.view(now);
  }
  /** Stop the caller's timer first; close awaits an in-flight send before closing SQLite. */
  async close(): Promise<void> {
    if (this.closed) { await this.running; return; }
    this.closed = true;
    try { await this.running; } finally { this.db.close(); }
  }
}
