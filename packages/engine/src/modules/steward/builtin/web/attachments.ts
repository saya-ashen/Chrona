import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const invalid = (message: string) => Object.assign(new Error(message), { code: "invalid" });
export type Attachment = { ref: string; name: string; mime: string; size: number };
const ownRef = /^web\/attachments\/[a-f0-9-]{36}(?:\.(?:png|jpg|gif|webp))?$/;
const imageExtension: Partial<Record<string, string>> = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" };
export function decodeBase64(value: unknown, limit = MAX_ATTACHMENT_BYTES) {
  if (typeof value !== "string" || value.length > Math.ceil(limit / 3) * 4 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw invalid("附件 base64 无效或过大");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > limit || bytes.toString("base64") !== value) throw invalid("附件 base64 无效或过大");
  return bytes;
}
/** Bound request bodies before JSON parsing, including requests without Content-Length. */
export async function attachmentBody(request: Request) {
  const reader = request.body?.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  if (!reader) throw invalid("缺少附件");
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 4096) throw invalid("附件过大");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw invalid("附件 JSON 无效"); }
}
function uploadInput(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("附件格式无效");
  const { name, mime, base64 } = input as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim() || name.length > 200 || typeof mime !== "string" || !/^[\w.+-]+\/[\w.+-]+$/.test(mime) || mime.length > 100) throw invalid("附件名称或类型无效");
  return { name, mime, bytes: decodeBase64(base64) };
}
export function createAttachments(contentDir: string) {
  const directory = join(contentDir, "attachments");
  async function read(ref: string, metadata = false) {
    if (!ownRef.test(ref)) throw invalid("只能读取 Web 上传的附件");
    return readFile(`${ref.slice(4)}${metadata ? ".json" : ""}`, metadata ? 4096 : MAX_ATTACHMENT_BYTES);
  }
  async function readFile(relative: string, limit: number) {
    const path = join(contentDir, relative);
    const root = await realpath(contentDir);
    if ((await lstat(directory)).isSymbolicLink() || await realpath(directory) !== join(root, "attachments")) throw invalid("附件目录无效");
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > limit || await realpath(path) !== join(root, relative)) throw invalid("附件不是有界普通文件");
      const bytes = Buffer.alloc(stat.size + 1);
      let size = 0;
      while (size < bytes.length) {
        const { bytesRead } = await handle.read(bytes, size, bytes.length - size, size);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size !== stat.size) throw invalid("附件读取期间发生变化");
      return bytes.subarray(0, size);
    } finally { await handle.close(); }
  }
  async function metadata(ref: string): Promise<Attachment> {
    if (!ownRef.test(ref)) throw invalid("只能发送 Web 上传的附件");
    const value = JSON.parse((await read(ref, true)).toString("utf8")) as Attachment | null;
    if (!value || value.ref !== ref || typeof value.name !== "string" || typeof value.mime !== "string" || !Number.isInteger(value.size) || value.size < 0 || value.size > MAX_ATTACHMENT_BYTES) throw invalid("附件记录无效");
    return value;
  }
  return {
    read,
    async upload(input: unknown) {
      const { name, mime, bytes } = uploadInput(input), ref = `web/attachments/${crypto.randomUUID()}${imageExtension[mime] ?? ""}`;
      await mkdir(directory, { recursive: true });
      const root = await realpath(contentDir);
      if ((await lstat(directory)).isSymbolicLink() || await realpath(directory) !== join(root, "attachments")) throw invalid("附件目录无效");
      const attachment: Attachment = { ref, name, mime, size: bytes.length };
      await writeFile(join(contentDir, ref.slice(4)), bytes, { flag: "wx", mode: 0o600 });
      await writeFile(join(contentDir, `${ref.slice(4)}.json`), JSON.stringify(attachment), { flag: "wx", mode: 0o600 });
      return attachment;
    },
    async accept(input: unknown) {
      if (input === undefined) return [];
      if (!Array.isArray(input) || input.length > 10) throw invalid("最多 10 个附件");
      const files: Attachment[] = [];
      let size = 0;
      for (const value of input) {
        if (!value || typeof value !== "object" || typeof value.ref !== "string") throw invalid("附件引用无效");
        const file = await metadata(value.ref), bytes = await read(file.ref);
        if (bytes.length !== file.size || (size += bytes.length) > MAX_ATTACHMENT_BYTES) throw invalid("附件总量超过 20 MiB 或内容已变化");
        files.push(file);
      }
      return files;
    },
  };
}
