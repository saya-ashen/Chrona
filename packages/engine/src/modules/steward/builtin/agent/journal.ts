import { open, rename } from "node:fs/promises";
import { dirname } from "node:path";

async function syncDirectory(path: string) {
  const directory = await open(path, "r");
  try { await directory.sync(); } finally { await directory.close(); }
}
/** Commit identity before launch and outcomes before acknowledgement. Sync errors remain failures. */
export async function writeAgentJournal(path: string, value: unknown, exclusive = false) {
  const target = exclusive ? path : path + ".pending";
  const file = await open(target, exclusive ? "wx" : "w", 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); }
  finally { await file.close(); }
  if (!exclusive) await rename(target, path);
  await syncDirectory(dirname(path));
  // The operation directory itself may have been created immediately before the first claim.
  await syncDirectory(dirname(dirname(path)));
}
