import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { nextOccurrence, scheduleRuleSchema } from "./rules";

const inputSchema = z.object({
  rule: z.string().max(1000).transform(value => scheduleRuleSchema.parse(JSON.parse(value))),
  text: z.string().trim().min(1).max(10000), label: z.string().trim().min(1).max(200),
  until: z.string().datetime({ offset: true }).optional(), timezone: z.string().min(1).max(100).optional(),
}).strict();
const rowSchema = z.object({ key: z.string(), label: z.string(), text: z.string(), rule: z.string().transform(value => scheduleRuleSchema.parse(JSON.parse(value))), timezone: z.string(), untilAt: z.string().nullable(), nextAt: z.string().nullable(), status: z.enum(["active", "cancelled", "finished", "unknown"]) });
type Send = (args: { key: string; level: "now"; title: string; body: string }) => Promise<unknown>;

/** App-private timers and delivery journal. An uncertain external delivery is never replayed. */
export class Reminders {
  private readonly db: Database;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(directory: string, private readonly send: Send) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "reminders.sqlite");
    this.db = new Database(path, { create: true, strict: true });
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS reminders (key TEXT PRIMARY KEY, label TEXT NOT NULL, text TEXT NOT NULL, rule TEXT NOT NULL, timezone TEXT NOT NULL, untilAt TEXT, nextAt TEXT, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries (key TEXT PRIMARY KEY, reminderKey TEXT NOT NULL, firedAt TEXT NOT NULL, status TEXT NOT NULL, notificationId TEXT);`);
  }
  create(raw: unknown, now: Date) {
    const input = inputSchema.parse(raw), timezone = input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const key = `r-${createHash("sha256").update(JSON.stringify([input.rule, input.text, input.label, input.until ?? null, timezone])).digest("hex").slice(0, 24)}`;
    const existing = this.db.query("SELECT * FROM reminders WHERE key = ?").get(key);
    if (existing) { const row = rowSchema.parse(existing); return { key, nextAt: row.nextAt, status: row.status }; }
    const next = nextOccurrence(input.rule, now, timezone);
    if (!next || (input.until && Date.parse(input.until) < next.getTime())) throw new Error("invalid: 提醒时间必须在将来且不晚于截止时间");
    this.db.query("INSERT INTO reminders VALUES (?, ?, ?, ?, ?, ?, ?, 'active')").run(key, input.label, input.text, JSON.stringify(input.rule), timezone, input.until ?? null, next.toISOString());
    return { key, nextAt: next.toISOString(), status: "active" };
  }
  list() {
    return { reminders: this.db.query("SELECT * FROM reminders WHERE status != 'cancelled' ORDER BY nextAt, key").all().map(raw => {
      const row = rowSchema.parse(raw);
      return { key: row.key, label: row.label, text: row.text, rule: row.rule, status: row.status, nextAt: row.nextAt };
    }) };
  }
  cancel(raw: unknown) {
    const { key } = z.object({ key: z.string().min(1).max(100) }).strict().parse(raw);
    return { cancelled: this.db.query("UPDATE reminders SET status = 'cancelled', nextAt = NULL WHERE key = ? AND status != 'cancelled'").run(key).changes > 0 };
  }
  tick(now: Date) {
    const work = this.tail.then(async () => {
      const due = this.db.query("SELECT * FROM reminders WHERE status = 'active' AND nextAt <= ? ORDER BY nextAt LIMIT 100").all(now.toISOString());
      for (const raw of due) {
        const row = rowSchema.parse(raw), firedAt = row.nextAt!, key = `${row.key}:${firedAt}`;
        // Claim before awaiting any routed effect, so cancel/restart cannot duplicate it.
        const claimed = this.db.transaction(() => {
          const result = this.db.query("UPDATE reminders SET status = 'unknown' WHERE key = ? AND status = 'active'").run(row.key);
          if (result.changes) this.db.query("INSERT INTO deliveries VALUES (?, ?, ?, 'unknown', NULL)").run(key, row.key, firedAt);
          return result.changes > 0;
        })();
        if (!claimed) continue;
        if (row.untilAt && Date.parse(row.untilAt) < now.getTime()) {
          this.db.transaction(() => {
            this.db.query("UPDATE reminders SET status = 'finished', nextAt = NULL WHERE key = ?").run(row.key);
            this.db.query("UPDATE deliveries SET status = 'expired' WHERE key = ?").run(key);
          })();
          continue;
        }
        const receipt = z.object({ id: z.string().min(1).max(200), status: z.string().min(1).max(100), duplicate: z.boolean() }).strict().parse(await this.send({ key, level: "now", title: row.label, body: row.text }));
        const next = nextOccurrence(row.rule, now, row.timezone);
        const nextAt = next && (!row.untilAt || next.getTime() <= Date.parse(row.untilAt)) ? next.toISOString() : null;
        this.db.transaction(() => {
          this.db.query("UPDATE deliveries SET status = ?, notificationId = ? WHERE key = ?").run(receipt.status, receipt.id, key);
          // Cancellation during delivery remains authoritative.
          this.db.query("UPDATE reminders SET status = ?, nextAt = ? WHERE key = ? AND status = 'unknown'").run(nextAt ? "active" : "finished", nextAt, row.key);
        })();
      }
    });
    this.tail = work.catch(() => {}); return work;
  }
  async close() { await this.tail; this.db.close(); }
}
