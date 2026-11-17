import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, realpath, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { StewardError } from "./errors";

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
  const full = await realpath(join(root, path)).catch(() => { throw new StewardError("not_found", `No file ${path} in the working directory`); });
  const rel = relative(root, full);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new StewardError("forbidden", "Files must be in the working directory");
  return { name: basename(path), bytes: await readBoundedFile(full), mime: Bun.file(full).type || "application/octet-stream" };
}
async function receivingModule(ports: StewardPorts, workspaceId: string, sessionId: string | null) {
  const seen = new Set<string>();
  while (sessionId) {
    if (seen.has(sessionId)) throw new StewardError("invalid", "Conversation origin cycle");
    seen.add(sessionId);
    const row = await ports.db.session.findFirst({ where: { id: sessionId, workspaceId } });
    if (!row) break;
    const moduleId = row.entryModuleId ?? (row.source === "module" ? row.moduleId : null);
    if (moduleId) return ports.db.module.findFirst({ where: { id: moduleId, workspaceId } });
    sessionId = row.originSessionId;
  }
  throw new StewardError("forbidden", "File delivery requires a receiving application");
}
/** Copy an output, never an arbitrary app reference, into its real recipient's content area. */
export async function captureRunFile(ports: StewardPorts, workspaceId: string, runId: string, path: string) {
  const run = await ports.db.run.findFirst({ where: { id: runId, workspaceId } });
  if (!run) throw new StewardError("not_found", "Run not found");
  const module = await receivingModule(ports, workspaceId, run.sessionId);
  if (!module?.activeHash) throw new StewardError("forbidden", "Receiving application is unavailable");
  const version = await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } });
  if (!version || version.status !== "approved" || !moduleManifestSchema.parse(version.manifest).content) throw new StewardError("forbidden", "Receiving application has no content area");
  const file = await readWorkspaceFile(run.cwd, path);
  const safe = file.name.normalize("NFKC").replace(/[^\p{L}\p{N}._-]/gu, "_").replace(/^\.+/, "").slice(0, 180) || "attachment";
  const parent = join(ports.dataDir, "platform", "content");
  await mkdir(parent, { recursive: true });
  const root = join(await realpath(parent), module.id);
  await mkdir(root, { recursive: true });
  if (await realpath(root) !== root) throw new StewardError("forbidden", "Receiving content path was replaced");
  const directory = join(root, "outputs");
  await mkdir(directory, { recursive: true });
  const actual = await realpath(directory);
  if (actual !== directory) throw new StewardError("forbidden", "Receiving content path was replaced");
  const name = `${randomUUID()}-${safe}`;
  await writeFile(join(actual, name), file.bytes, { flag: "wx", mode: 0o600 });
  return { name: safe, ref: `${module.name}/outputs/${name}`, size: file.bytes.byteLength, mime: file.mime, sha256: createHash("sha256").update(file.bytes).digest("hex") };
}
