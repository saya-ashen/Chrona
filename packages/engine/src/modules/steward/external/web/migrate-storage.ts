import { existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

/** Disk conversion is performed offline with the complete kernel/private-data snapshot. */
export function verifyConvertedStorage(directory: string) {
  const root = join(directory, "conversations"), path = join(root, "sessions.sqlite");
  if (existsSync(join(root, "state.json"))) throw Error("Legacy conversation storage requires the one-time offline converter");
  if (!existsSync(path)) return; // No conversation has been created yet.
  const db = new Database(path, { readonly: true });
  try {
    if (db.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check !== "ok") throw Error("Conversation database integrity check failed");
    db.query("SELECT id,data FROM conversations LIMIT 1").get();
  } finally { db.close(); }
}
if (import.meta.main) {
  const input = JSON.parse(await Bun.stdin.text());
  if (input?.migrate?.from !== 1 || input?.migrate?.to !== 2 || !process.env.CHRONA_DATA) throw Error("Only explicit schema 1 to 2 is supported");
  verifyConvertedStorage(process.env.CHRONA_DATA);
}
