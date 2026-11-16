import { existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

/** Preserve original receipts and recovery generation; never initialize an empty replacement. */
export function verifyConvertedStorage(directory: string) {
  const legacy = ["mind-core.sqlite", "mind-execution.sqlite", "mind-delivery.sqlite", "mind-delivery-admission.sqlite",
    "mind-application.sqlite", "mind-artifacts.sqlite", "mind-notifications.sqlite", "admission/mind-execution.sqlite", "verification/mind-execution.sqlite"];
  if (legacy.some(file => existsSync(join(directory, file)))) throw Error("Legacy Mind storage requires the one-time offline converter");
  const path = join(directory, "mind.sqlite");
  if (!existsSync(path)) return; // A newly installed application has no persisted memory yet.
  const db = new Database(path, { readonly: true });
  try {
    if (db.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check !== "ok") throw Error("Mind database integrity check failed");
    db.query("SELECT key,data FROM mind_meta LIMIT 1").get();
  } finally { db.close(); }
}
if (import.meta.main) {
  const input = JSON.parse(await Bun.stdin.text());
  if (input?.migrate?.from !== 1 || input?.migrate?.to !== 2 || !process.env.CHRONA_DATA) throw Error("Only explicit schema 1 to 2 is supported");
  verifyConvertedStorage(process.env.CHRONA_DATA);
}
