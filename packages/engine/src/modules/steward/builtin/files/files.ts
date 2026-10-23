import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, posix, resolve } from "node:path";

type Version = { version: string; at: string; size: number; deleted: boolean; hash: string | null };
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const fits = (value: unknown) => Buffer.byteLength(JSON.stringify(value)) <= 16_384;

/** Roots are fixed by the sandbox. Tests supply isolated temporary roots. */
export function createFiles(content: string, data: string) {
  const root = resolve(content), historyRoot = join(data, "history");
  function relative(value: unknown, allowRoot = false): string {
    if (typeof value !== "string" || (!value && !allowRoot) || value.length > 2000 || isAbsolute(value) || value.includes("\\") || value.includes("\0") || (value && value.split("/").some(part => !part || part === "." || part === ".." || part === ".git"))) throw new Error("Invalid content path");
    return value;
  }
  async function target(path: string, parents = false) {
    const base = await lstat(root);
    if (!base.isDirectory() || base.isSymbolicLink()) throw new Error("Unsafe content root");
    let current = root;
    for (const [index, part] of path.split("/").filter(Boolean).entries()) {
      current = join(current, part);
      let info;
      try { info = await lstat(current); }
      catch (error) {
        if (!missing(error)) throw error;
        if (index === path.split("/").length - 1) return current;
        if (!parents) throw error;
        await mkdir(current); info = await lstat(current);
      }
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || (info.isFile() && info.nlink !== 1)) throw new Error("Unsafe content path");
    }
    return current;
  }
  async function bytes(path: string) {
    const handle = await open(await target(path), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1) throw new Error("Not a safe file");
      return await handle.readFile();
    } finally { await handle.close(); }
  }
  const versionDir = (path: string) => join(historyRoot, digest(path));
  async function versions(path: string): Promise<Version[]> {
    try { return JSON.parse(await readFile(join(versionDir(path), "index.json"), "utf8")); }
    catch (error) { if (missing(error)) return []; throw error; }
  }
  async function record(path: string, at: string) {
    let value: Buffer | null;
    try { value = await bytes(path); }
    catch (error) { if (!missing(error)) throw error; value = null; }
    const items = await versions(path), hash = value === null ? null : digest(value);
    if ((!items.length && value === null) || (items.length && items.at(-1)!.hash === hash)) return;
    const dir = versionDir(path), version = randomUUID();
    await mkdir(dir, { recursive: true });
    if (value !== null) await writeFile(join(dir, version), value);
    items.push({ version, at, size: value?.length ?? 0, deleted: value === null, hash });
    const removed = items.splice(0, Math.max(0, items.length - 20));
    const temporary = join(dir, "index.tmp");
    await writeFile(temporary, JSON.stringify(items));
    await rename(temporary, join(dir, "index.json"));
    for (const item of removed) if (!item.deleted) await rm(join(dir, item.version), { force: true });
  }
  async function tree(path: string): Promise<string[]> {
    const full = await target(path);
    const info = await lstat(full);
    if (info.isFile()) return [path];
    const result: string[] = [];
    for (const entry of await readdir(full)) result.push(...await tree(posix.join(path, relative(entry))));
    return result;
  }
  async function put(path: string, value: Uint8Array) {
    const handle = await open(await target(path, true), constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o644);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1) throw new Error("Not a safe file");
      await handle.truncate(0); await handle.writeFile(value);
    } finally { await handle.close(); }
  }
  async function move(from: string, to: string, at: string) {
    const paths = await tree(from);
    for (const path of paths) await record(path, at);
    const destination = await target(to, true);
    try { await lstat(destination); throw new Error("Destination already exists"); }
    catch (error) { if (!missing(error)) throw error; }
    await rename(await target(from), destination);
    for (const path of paths) {
      await record(path, at);
      await record(to + path.slice(from.length), at);
    }
  }
  return {
    async contentEdit(paths: string[], at: string) {
      for (const value of paths) {
        const path = relative(value);
        try { for (const file of await tree(path)) await record(file, at); }
        catch (error) { if (!missing(error)) throw error; await record(path, at); }
      }
    },
    async tool(id: string, args: Record<string, unknown>, at: string): Promise<unknown> {
      try {
        if (id === "list") {
          const dir = relative(args.dir ?? "", true), entries: { name: string; kind: string }[] = [];
          let truncated = false;
          for (const name of (await readdir(await target(dir))).sort()) {
            // Never expose .git or follow links, including links to other content areas.
            if (name === ".git") continue;
            const info = await lstat(join(root, dir, name));
            if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || (info.isFile() && info.nlink !== 1)) continue;
            entries.push({ name, kind: info.isDirectory() ? "directory" : "file" });
            if (!fits({ entries, truncated: false })) { entries.pop(); truncated = true; break; }
          }
          return { entries, truncated };
        }
        if (id === "move") {
          const from = relative(args.from), to = relative(args.to);
          await move(from, to, at); return { ok: true };
        }
        const path = relative(args.path);
        if (id === "read") {
          const value = await bytes(path), mime = Bun.file(join(root, path)).type || "application/octet-stream";
          const textual = mime.startsWith("text/") || /(?:json|xml|javascript|yaml|toml)(?:;|$)/.test(mime);
          if (!textual && (mime !== "application/octet-stream" || /\.(?:bin|dat)$/i.test(path))) return { size: value.length, mime };
          let text: string;
          try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(value);
            if (/[\x00-\x08\x0e-\x1f]/.test(text)) throw new Error("binary");
          } catch { return { size: value.length, mime }; }
          const result = { size: value.length, mime, content: text, truncated: false };
          if (!fits(result)) {
            result.truncated = true;
            let end = Math.min(text.length, 16_384);
            do { result.content = text.slice(0, end) + "\n[truncated]"; end = Math.floor(end * 0.8); } while (!fits(result));
          }
          return result;
        }
        if (id === "history") return { versions: await versions(path) };
        if (id === "write") {
          if (typeof args.content !== "string") throw new Error("content must be a string");
          await record(path, at); await put(path, Buffer.from(args.content)); await record(path, at);
          return { ok: true };
        }
        if (id === "restore") {
          const version = (await versions(path)).find(item => item.version === args.version && !item.deleted);
          if (!version) throw new Error("Version not found");
          const value = await readFile(join(versionDir(path), version.version));
          await record(path, at); await put(path, value); await record(path, at);
          return { ok: true };
        }
        if (id === "delete") {
          // shortcut: delete goes to .trash; becomes an approved action in v2-5
          const trash = `.trash/${randomUUID()}/${path}`;
          await move(path, trash, at); return { ok: true, path: trash };
        }
        throw new Error("Unknown files tool");
      } catch (error) { return { error: (error instanceof Error ? error.message : String(error)).slice(0, 1000) }; }
    },
  };
}
