import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, posix, resolve } from "node:path";

type Version = { version: string; at: string; size: number; deleted: boolean; hash: string | null };
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const fits = (value: unknown) => Buffer.byteLength(JSON.stringify(value)) <= 16_384;
function checkTargetInfo(info: Awaited<ReturnType<typeof lstat>>) {
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || (info.isFile() && info.nlink !== 1)) throw new Error("Unsafe content path");
}

type ToolArgs = Record<string, unknown>;

class FilesRuntime {
  private readonly root: string;
  private readonly historyRoot: string;
  constructor(content: string, data: string) {
    this.root = resolve(content);
    this.historyRoot = join(data, "history");
  }
  /** Roots are fixed by the sandbox. Tests supply isolated temporary roots. */
  private relative(value: unknown, allowRoot = false): string {
    if (typeof value !== "string" || (!value && !allowRoot) || value.length > 2000 || isAbsolute(value) || value.includes("\\") || value.includes("\0") || (value && value.split("/").some(part => !part || part === "." || part === ".." || part === ".git"))) throw new Error("Invalid content path");
    return value;
  }
  private async target(path: string, parents = false) {
    const base = await lstat(this.root);
    if (!base.isDirectory() || base.isSymbolicLink()) throw new Error("Unsafe content root");
    let current = this.root;
    const parts = path.split("/").filter(Boolean);
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      let info;
      try { info = await lstat(current); }
      catch (error) {
        if (!missing(error)) throw error;
        if (index === parts.length - 1) return current;
        if (!parents) throw error;
        await mkdir(current); info = await lstat(current);
      }
      checkTargetInfo(info);
    }
    return current;
  }
  private async bytes(path: string) {
    const handle = await open(await this.target(path), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1) throw new Error("Not a safe file");
      return await handle.readFile();
    } finally { await handle.close(); }
  }
  private versionDir(path: string) { return join(this.historyRoot, digest(path)); }
  private async versions(path: string): Promise<Version[]> {
    try { return JSON.parse(await readFile(join(this.versionDir(path), "index.json"), "utf8")); }
    catch (error) { if (missing(error)) return []; throw error; }
  }
  private async record(path: string, at: string) {
    const value = await this.recordedValue(path), items = await this.versions(path), hash = value === null ? null : digest(value);
    if ((!items.length && value === null) || (items.length && items.at(-1)!.hash === hash)) return;
    const dir = this.versionDir(path), version = randomUUID();
    await mkdir(dir, { recursive: true });
    if (value !== null) await writeFile(join(dir, version), value);
    items.push({ version, at, size: value?.length ?? 0, deleted: value === null, hash });
    const removed = items.splice(0, Math.max(0, items.length - 20)), temporary = join(dir, "index.tmp");
    await writeFile(temporary, JSON.stringify(items));
    await rename(temporary, join(dir, "index.json"));
    for (const item of removed) if (!item.deleted) await rm(join(dir, item.version), { force: true });
  }
  private async recordedValue(path: string) {
    try { return await this.bytes(path); }
    catch (error) { if (!missing(error)) throw error; return null; }
  }
  private async tree(path: string): Promise<string[]> {
    const full = await this.target(path), info = await lstat(full);
    if (info.isFile()) return [path];
    const result: string[] = [];
    for (const entry of await readdir(full)) result.push(...await this.tree(posix.join(path, this.relative(entry))));
    return result;
  }
  private async put(path: string, value: Uint8Array) {
    const handle = await open(await this.target(path, true), constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o644);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1) throw new Error("Not a safe file");
      await handle.truncate(0); await handle.writeFile(value);
    } finally { await handle.close(); }
  }
  private async move(from: string, to: string, at: string) {
    const paths = await this.tree(from);
    for (const path of paths) await this.record(path, at);
    const destination = await this.target(to, true);
    try { await lstat(destination); throw new Error("Destination already exists"); }
    catch (error) { if (!missing(error)) throw error; }
    await rename(await this.target(from), destination);
    for (const path of paths) {
      await this.record(path, at);
      await this.record(to + path.slice(from.length), at);
    }
  }
  // eslint-disable-next-line complexity -- Keep link rejection and response-size checks adjacent to directory enumeration.
  private async list(args: ToolArgs) {
    // path and parent let a page browse without joining paths itself.
    const dir = this.relative(args.dir ?? "", true), entries: { name: string; kind: string; path: string }[] = [];
    let truncated = false;
    for (const name of (await readdir(await this.target(dir))).sort()) {
      // Never expose .git or follow links, including links to other content areas.
      if (name === ".git") continue;
      const info = await lstat(join(this.root, dir, name));
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || (info.isFile() && info.nlink !== 1)) continue;
      entries.push({ name, kind: info.isDirectory() ? "directory" : "file", path: dir ? `${dir}/${name}` : name });
      if (!fits({ dir, parent: dir, entries, truncated: false })) { entries.pop(); truncated = true; break; }
    }
    return { dir, parent: dir ? dir.split("/").slice(0, -1).join("/") : null, entries, truncated };
  }
  private async read(path: string) {
    const value = await this.bytes(path), mime = Bun.file(join(this.root, path)).type || "application/octet-stream";
    const textual = mime.startsWith("text/") || /(?:json|xml|javascript|yaml|toml)(?:;|$)/.test(mime);
    if (!textual && (mime !== "application/octet-stream" || /\.(?:bin|dat)$/i.test(path))) return { size: value.length, mime };
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(value);
      if (value.some(byte => byte < 9 || (byte > 13 && byte < 32))) throw new Error("binary");
    } catch { return { size: value.length, mime }; }
    const result = { size: value.length, mime, content: text, truncated: false };
    if (!fits(result)) {
      result.truncated = true;
      let end = Math.min(text.length, 16_384);
      do { result.content = text.slice(0, end) + "\n[truncated]"; end = Math.floor(end * 0.8); } while (!fits(result));
    }
    return result;
  }
  private async write(path: string, args: ToolArgs, at: string) {
    if (typeof args.content !== "string") throw new Error("content must be a string");
    await this.record(path, at); await this.put(path, Buffer.from(args.content)); await this.record(path, at);
    return { ok: true };
  }
  private async restore(path: string, args: ToolArgs, at: string) {
    const version = (await this.versions(path)).find(item => item.version === args.version && !item.deleted);
    if (!version) throw new Error("Version not found");
    const value = await readFile(join(this.versionDir(path), version.version));
    await this.record(path, at); await this.put(path, value); await this.record(path, at);
    return { ok: true };
  }
  private async remove(path: string, at: string) {
    // shortcut: delete goes to .trash; becomes an approved action in v2-5
    const trash = `.trash/${randomUUID()}/${path}`;
    await this.move(path, trash, at); return { ok: true, path: trash };
  }
  async tool(id: string, args: ToolArgs, at: string): Promise<unknown> {
    try {
      const handlers: Record<string, () => Promise<unknown>> = {
        list: () => this.list(args),
        move: async () => { const from = this.relative(args.from), to = this.relative(args.to); await this.move(from, to, at); return { ok: true }; },
        read: () => this.read(this.relative(args.path)),
        history: async () => ({ versions: await this.versions(this.relative(args.path)) }),
        write: () => this.write(this.relative(args.path), args, at),
        restore: () => this.restore(this.relative(args.path), args, at),
        delete: () => this.remove(this.relative(args.path), at),
      };
      if (!Object.hasOwn(handlers, id)) { this.relative(args.path); throw new Error("Unknown files tool"); }
      return await handlers[id]!();
    } catch (error) { return { error: (error instanceof Error ? error.message : String(error)).slice(0, 1000) }; }
  }
}

export function createFiles(content: string, data: string) {
  const runtime = new FilesRuntime(content, data);
  return { tool: runtime.tool.bind(runtime) };
}
