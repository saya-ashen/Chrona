import { Database } from "bun:sqlite";
import { join } from "node:path";

/** Additive, transactional v1→v2 upgrade. Existing text, leases, settings and receipts stay untouched. */
export function migrateFormat(dir: string) {
  const db = new Database(join(dir, "notify.db"));
  try {
    db.transaction(() => {
      const columns = db.query("PRAGMA table_info(notifications)").all() as { name: string }[];
      // An empty data directory is initialized by openStore on first normal startup.
      if (columns.length && !columns.some(column => column.name === "format")) {
        db.exec("ALTER TABLE notifications ADD COLUMN format TEXT NOT NULL DEFAULT 'text' CHECK (format IN ('text', 'markdown'))");
      }
    })();
  } finally { db.close(); }
}

if (import.meta.main) {
  const input = JSON.parse(await Bun.stdin.text());
  if (input?.migrate?.from !== 1 || input?.migrate?.to !== 2) throw new Error("Only schema 1 to 2 is supported");
  const dir = process.env.CHRONA_DATA;
  if (!dir) throw new Error("CHRONA_DATA is required");
  migrateFormat(dir);
}
