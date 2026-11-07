import { randomUUID } from "node:crypto";
import { mkdir, open, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { StewardPorts } from "./ports";
import { StewardError } from "./errors";
export const CONTENT_FILE_MAX_BYTES = 20 * 1024 * 1024;
/** Bound allocations and reject replaced final symlinks before reading bytes. */
export async function readContentFile(path: string, maxBytes: number) {
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
/** The conversations' files (uploads and reply attachments), kept by the system module chat like a module keeps its data (v2-8). */
export const chatFilesDir = (ports: Pick<StewardPorts, "dataDir">) => join(ports.dataDir, "platform", "data", "chat");
/** Stores bytes under a unique name; the reference is `chat/<file>` (Provider runs see content/chat/<file>). */
export async function storeChatFile(ports: Pick<StewardPorts, "dataDir">, name: string, bytes: Uint8Array) {
  const safe = name.normalize("NFKC").replaceAll("\\", "/").split("/").pop()!.replace(/[^\p{L}\p{N}._-]/gu, "_").replace(/^\.+/, "").slice(0, 180) || "attachment";
  const file = `${randomUUID()}-${safe}`;
  await mkdir(chatFilesDir(ports), { recursive: true });
  await writeFile(join(chatFilesDir(ports), file), bytes, { flag: "wx" });
  return { name: safe, ref: `chat/${file}`, size: bytes.byteLength };
}
/** A stored conversation file by its `chat/<file>` reference, or null. */
/**
 * A file a run hands over, kept by chat: an attachment it received (content/chat/<file>) or a file in its working
 * directory, copied in. Never a host path outside the run's directory.
 */
export async function runFile(ports: Pick<StewardPorts, "dataDir">, cwd: string, path: string) {
  if (path.startsWith("content/chat/")) {
    const ref = `chat/${path.slice("content/chat/".length)}`, file = await readChatFile(ports, ref);
    if (!file) throw new StewardError("not_found", `No received attachment ${path}`);
    return { name: path.split("/").pop()!.replace(/^[0-9a-f-]{36}-/, ""), ref, size: file.bytes.byteLength };
  }
  const root = await realpath(cwd);
  const full = await realpath(join(root, path)).catch(() => { throw new StewardError("not_found", `No file ${path} in the working directory`); });
  const rel = relative(root, full);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new StewardError("forbidden", "Files must be in the working directory");
  return storeChatFile(ports, path.split("/").pop()!, await readContentFile(full, CONTENT_FILE_MAX_BYTES));
}
export async function readChatFile(ports: Pick<StewardPorts, "dataDir">, ref: string) {
  const file = ref.startsWith("chat/") ? ref.slice(5) : "";
  if (!file || file.includes("/") || file.startsWith(".")) return null;
  const path = join(chatFilesDir(ports), file);
  try { return { bytes: await readContentFile(path, CONTENT_FILE_MAX_BYTES), mime: Bun.file(path).type || "application/octet-stream" }; }
  catch (error) { if (["ENOENT", "ENOTDIR", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) return null; throw error; }
}
