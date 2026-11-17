import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { StewardError } from "./errors";
import { redactSensitiveValue } from "@chrona/logging/redaction";

export const FILE_MAX_BYTES = 20 * 1024 * 1024;
/** Bound allocations and reject final symlink replacement before reading. */
export async function readBoundedFile(path: string, maxBytes = FILE_MAX_BYTES) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new StewardError("invalid", "Content must be a regular file");
    if (info.size > maxBytes) throw new StewardError("invalid", "Content exceeds read limit");
    const bytes = Buffer.alloc(Math.min(info.size, maxBytes) + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > maxBytes || offset > info.size) throw new StewardError("invalid", "Content changed during read");
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}
/** Internal host read: cwd has already been selected by the authenticated Run. */
export async function readWorkspaceFile(cwd: string, path: string) {
  const root = await realpath(cwd);
  const full = await realpath(join(root, path)).catch(error => {
    console.error(JSON.stringify({ component: "workspace-files", event: "file_unavailable", error: redactSensitiveValue(error) }));
    throw new StewardError("not_found", `No file ${path} in the working directory`);
  });
  const rel = relative(root, full);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new StewardError("forbidden", "Files must be in the working directory");
  return { name: basename(path), bytes: await readBoundedFile(full), mime: Bun.file(full).type || "application/octet-stream" };
}
