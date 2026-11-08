import { open, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

// Pi's JSONL session header contains { type: "session", id, cwd }. Read only
// the first physical line, with the same 1 MiB ceiling as Pi header discovery.
const HEADER_LIMIT = 1024 * 1024;
async function sessionHeader(path: string): Promise<{ type?: unknown; id?: unknown; cwd?: unknown } | null> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(HEADER_LIMIT);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, Math.min(4096, buffer.length - length), null);
      if (!bytesRead) return JSON.parse(buffer.subarray(0, length).toString("utf8"));
      const newline = buffer.subarray(length, length + bytesRead).indexOf(10);
      if (newline !== -1) return JSON.parse(buffer.subarray(0, length + newline).toString("utf8"));
      length += bytesRead;
    }
    throw new Error("Pi session header exceeds the read limit");
  } finally { await file.close(); }
}

/** Execution resumes must not let --session-id silently create an empty context. */
export async function validatePiSessionResume(input: { sessionDir: string; sessionId: string; cwd: string }): Promise<string | null> {
  let entries;
  try { entries = await readdir(input.sessionDir, { withFileTypes: true }); }
  catch { return "Pi resume context is missing or unreadable"; }
  let mismatchedCwd = false;
  for (const entry of entries.filter(entry => entry.isFile() && entry.name.endsWith(".jsonl"))) {
    let header;
    try { header = await sessionHeader(join(input.sessionDir, entry.name)); }
    catch { continue; } // Unrelated corrupt files are not resume candidates.
    if (header?.type !== "session" || header.id !== input.sessionId) continue;
    if (typeof header.cwd === "string" && isAbsolute(header.cwd) && resolve(header.cwd) === resolve(input.cwd)) return null;
    mismatchedCwd = true;
  }
  return mismatchedCwd ? "Pi resume context cwd does not match the authorized working directory" : "Pi resume context is missing or invalid for the requested session ID";
}
