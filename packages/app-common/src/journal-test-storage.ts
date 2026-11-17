import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { readFile as readOrdinaryFile, writeFile as writeOrdinaryFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Test fixtures address conversation rows directly; other files use the normal filesystem. */
export function readFile(path: string, encoding: "utf8"): Promise<string>;
export function readFile(path: string): Promise<Buffer>;
export async function readFile(path: string, encoding?: "utf8"): Promise<string | Buffer> {
  if (!path.endsWith("/sessions.sqlite")) return encoding ? readOrdinaryFile(path, encoding) : readOrdinaryFile(path);
  if (!existsSync(path)) throw Object.assign(new Error("Journal not found"), { code: "ENOENT" });
  const db = new Database(path, { readonly: true });
  try {
    const sessions = (db.query("SELECT data FROM conversations ORDER BY rowid").all() as { data: string }[]).map(row => JSON.parse(row.data));
    const text = JSON.stringify({ version: 1, sessions });
    return encoding ? text : Buffer.from(text);
  } finally { db.close(); }
}
export async function writeFile(path: string, data: string): Promise<void> {
  if (!path.endsWith("/sessions.sqlite")) return writeOrdinaryFile(path, data);
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    const state = JSON.parse(data);
    db.exec("CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, data TEXT NOT NULL)");
    db.transaction(() => {
      db.exec("DELETE FROM conversations");
      for (const session of state.sessions) db.query("INSERT INTO conversations VALUES(?,?)").run(session.id, JSON.stringify(session));
    })();
  } finally { db.close(); }
}
