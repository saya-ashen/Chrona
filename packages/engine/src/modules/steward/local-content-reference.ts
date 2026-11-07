import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { contentRefSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { readChatFile, readContentFile } from "./local-content-files";
import { StewardError } from "./errors";

/** Large results (images, documents) travel by reference `<module>/<path>`, never inside a tool's text result. */
export const CONTENT_READ_MAX_BYTES = 10 * 1024 * 1024;

/** A file in a module's content area (or a chat attachment, `chat/<file>`); the path never leaves that area. */
// eslint-disable-next-line complexity -- Keep path-containment and byte-limit security checks adjacent to the reads they protect.
export async function readLocalContentRef(ports: StewardPorts, workspaceId: string, ref: string, maxBytes = CONTENT_READ_MAX_BYTES) {
  if (!contentRefSchema.safeParse(ref).success) throw new StewardError("invalid", "ref must be <module>/<path>");
  const owner = ref.slice(0, ref.indexOf("/")), path = ref.slice(owner.length + 1);
  let bytes: Uint8Array, mime: string;
  if (owner === "chat") {
    const file = await readChatFile(ports, ref);
    if (!file) throw new StewardError("not_found", `No content ${ref}`);
    ({ bytes, mime } = file);
  } else {
    const module = await ports.db.module.findFirst({ where: { workspaceId, name: owner }, select: { id: true } });
    const root = module && await realpath(join(ports.dataDir, "platform", "content", module.id)).catch(() => null);
    const full = root && await realpath(join(root, path)).catch(() => null);
    const rel = root && full ? relative(root, full) : "";
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new StewardError("not_found", `No content ${ref}`);
    bytes = await readContentFile(full!, maxBytes);
    mime = Bun.file(full!).type || "application/octet-stream";
  }
  if (bytes.byteLength > maxBytes) throw new StewardError("invalid", `${ref} is larger than ${maxBytes} bytes`);
  return { ref, name: basename(path), mime, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}
