import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DEFAULT_SETTINGS, type Level, type Settings } from "./budget";

export type Format = "text" | "markdown";
export type Row = {
  id: string; key: string; module_id: string | null; app: string | null; session_id: string | null; approval_id: string | null; scoped: number;
  level: Level; web: number; responds: number; channel: string; status: string; title: string; body: string; format: Format; recipient: string | null; link: string | null;
  receipt_ref: string | null; attempts: number; last_error: string | null; next_attempt_at: number | null; call_id: string | null; call_at: number | null;
  created_at: number; sent_at: number | null; feedback: string | null; digest_id: string | null;
};
export type NewRow = Pick<Row, "key" | "module_id" | "app" | "session_id" | "approval_id" | "scoped" | "level" | "web" | "responds" | "status" | "title" | "body" | "recipient" | "link" | "created_at"> & Partial<Pick<Row, "format" | "id" | "channel" | "attempts" | "last_error" | "sent_at" | "receipt_ref" | "feedback" | "next_attempt_at">>;

/** The module's own state, in its data directory: notifications, settings and channel readiness. */
export function openStore(dir: string) {
  const db = new Database(join(dir, "notify.db"));
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, module_id TEXT, app TEXT, session_id TEXT, approval_id TEXT, scoped INTEGER NOT NULL DEFAULT 0,
      level TEXT NOT NULL, web INTEGER NOT NULL DEFAULT 0, responds INTEGER NOT NULL DEFAULT 0, channel TEXT NOT NULL DEFAULT 'in_app', status TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT NOT NULL, format TEXT NOT NULL DEFAULT 'text' CHECK (format IN ('text', 'markdown')), recipient TEXT, link TEXT, receipt_ref TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
      next_attempt_at INTEGER, call_id TEXT, call_at INTEGER, created_at INTEGER NOT NULL, sent_at INTEGER, feedback TEXT, digest_id TEXT);
    CREATE INDEX IF NOT EXISTS notifications_status ON notifications(status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS notifications_created ON notifications(created_at);
    CREATE INDEX IF NOT EXISTS notifications_call ON notifications(call_id);
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const get = (key: string) => (db.query("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | null)?.value ?? null;
  const set = (key: string, value: string) => db.run("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
  const row = (sql: string, ...args: (string | number | null)[]) => db.query(sql).get(...args) as Row | null;
  const rows = (sql: string, ...args: (string | number | null)[]) => db.query(sql).all(...args) as Row[];
  return {
    db, get, set, row, rows,
    byKey: (key: string) => row("SELECT * FROM notifications WHERE key = ?", key),
    byId: (id: string) => row("SELECT * FROM notifications WHERE id = ?", id),
    byCall: (callId: string) => row("SELECT * FROM notifications WHERE call_id = ?", callId),
    /** Inserts unless the key exists; returns the stored row either way. */
    insert(input: NewRow) {
      const id = input.id ?? randomUUID();
      db.run(`INSERT OR IGNORE INTO notifications (id, key, module_id, app, session_id, approval_id, scoped, level, web, responds, channel, status, title, body, recipient, link, created_at, attempts, last_error, sent_at, receipt_ref, feedback, next_attempt_at, format)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, input.key, input.module_id, input.app, input.session_id, input.approval_id, input.scoped, input.level, input.web, input.responds,
        input.channel ?? "in_app", input.status, input.title, input.body, input.recipient, input.link, input.created_at, input.attempts ?? 0, input.last_error ?? null, input.sent_at ?? null, input.receipt_ref ?? null, input.feedback ?? null, input.next_attempt_at ?? input.created_at, input.format ?? "text"]);
      return this.byKey(input.key)!;
    },
    update(id: string, fields: Partial<Row>) {
      const entries = Object.entries(fields);
      if (!entries.length) return;
      db.run(`UPDATE notifications SET ${entries.map(([name]) => `${name} = ?`).join(", ")} WHERE id = ?`, [...entries.map(([, value]) => value as string | number | null), id]);
    },
    settings(): Settings { const value = get("settings"); return value ? JSON.parse(value) as Settings : DEFAULT_SETTINGS; },
    close: () => db.close(),
  };
}
export type Store = ReturnType<typeof openStore>;
