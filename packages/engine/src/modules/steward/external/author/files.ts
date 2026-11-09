import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink, type FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { AuthorError, fail, relative } from "./contracts";

export const SOURCE_LIMITS = { fileBytes: 64 * 1024, totalBytes: 1024 * 1024, files: 200, entries: 400, outputBytes: 16384, readCharacters: 2000 } as const;
export type MaterialFile = { path: string; bytes: Buffer };
const safeFile = (stat: { isFile(): boolean; nlink: number }) => {
  if (!stat.isFile() || stat.nlink !== 1) throw new AuthorError("unsafe_source", "Source must be a regular file with one link.");
};
const boundedOutput = <T>(value: T): T => {
  if (Buffer.byteLength(JSON.stringify(value)) > SOURCE_LIMITS.outputBytes) throw new AuthorError("too_large", "Source result exceeds the output limit; select a smaller directory or read range.");
  return value;
};
async function withContent<T>(root: string, action: (handles: FileHandle[], root: FileHandle) => Promise<T>): Promise<T> {
  const handles: FileHandle[] = [];
  try {
    if (await realpath(root) !== root || !(await lstat(root)).isDirectory()) throw new AuthorError("unsafe_source", "The source root must be a real directory.");
    const handle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    handles.push(handle);
    return await action(handles, handle);
  } catch (error) {
    if (error instanceof AuthorError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new AuthorError("not_found", "Source path not found.");
    // Do not expose OS errors containing host paths or source contents.
    throw new AuthorError("source_io", "Source operation failed: missing, occupied, or unsafe path.");
  } finally { for (const handle of handles.reverse()) await handle.close().catch(() => {}); }
}
const child = (parent: FileHandle, part: string) => `/proc/self/fd/${parent.fd}/${part}`;
async function directory(handles: FileHandle[], start: FileHandle, parts: string[], create = false): Promise<FileHandle> {
  let current = start;
  for (const part of parts) {
    const path = child(current, part);
    if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    const next = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    handles.push(next);
    if (current !== start) await current.close();
    current = next;
  }
  return current;
}
async function readBytes(handles: FileHandle[], parent: FileHandle, part: string): Promise<Buffer> {
  const file = await open(child(parent, part), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  handles.push(file);
  try {
    const before = await file.stat();
    safeFile(before);
    if (before.size > SOURCE_LIMITS.fileBytes) throw new AuthorError("too_large", "Source file exceeds 64 KiB.");
    const buffer = Buffer.alloc(SOURCE_LIMITS.fileBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await file.read(buffer, length, buffer.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await file.stat();
    safeFile(after);
    if (length > SOURCE_LIMITS.fileBytes) throw new AuthorError("too_large", "Source file exceeds 64 KiB.");
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || length !== before.size) throw new AuthorError("conflict", "Source changed while reading; inspect it again.");
    return buffer.subarray(0, length);
  } finally { await file.close(); }
}
function visible(path: string, writing = false) {
  const parts = relative(path).split("/");
  if (!["sources", "packages"].includes(parts[0]) || (writing && (parts[0] !== "sources" || parts.length < 3))) return fail("Use source files under sources/<workspace>; packages are read-only.");
  if (parts.length > 1 && !/^[a-z][a-z0-9-]{0,63}$/.test(parts[1])) return fail("Expected a bounded workspace name.");
  return parts;
}
async function put(handles: FileHandle[], parent: FileHandle, part: string, bytes: Buffer) {
  if (bytes.length > SOURCE_LIMITS.fileBytes) throw new AuthorError("too_large", "Source file exceeds 64 KiB.");
  const file = await open(child(parent, part), constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_EXCL, 0o600);
  handles.push(file);
  try { safeFile(await file.stat()); await file.writeFile(bytes); }
  finally { await file.close(); }
}

async function snapshotFiles(handles: FileHandle[], root: FileHandle): Promise<MaterialFile[]> {
  const files: MaterialFile[] = [];
  let entries = 0, total = 0;
  const { opendir } = await import("node:fs/promises");
  async function visit(parent: FileHandle, prefix: string, depth: number) {
    if (depth > 16) return fail("Source tree is too deep.");
    for await (const item of await opendir(`/proc/self/fd/${parent.fd}`)) {
      if (++entries > SOURCE_LIMITS.entries) throw new AuthorError("too_large", "Source tree exceeds 400 entries.");
      const path = relative(prefix + item.name);
      const stat = await lstat(child(parent, item.name));
      if (stat.isDirectory()) {
        const dir = await directory(handles, parent, [item.name]);
        await visit(dir, `${path}/`, depth + 1);
      } else {
        safeFile(stat);
        if (files.length >= SOURCE_LIMITS.files) throw new AuthorError("too_large", "Source tree exceeds 200 files.");
        const bytes = await readBytes(handles, parent, item.name);
        total += bytes.length;
        if (total > SOURCE_LIMITS.totalBytes) throw new AuthorError("too_large", "Source tree exceeds 1 MiB.");
        files.push({ path, bytes });
      }
    }
  }
  await visit(root, "", 0);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/** Linux directory descriptors anchor traversal even if a parent is concurrently replaced.
 * /proc/self/fd resolves only descriptors opened below the SDK's own content root. */
export function createSourceFiles(content: string) {
  const root = resolve(content);
  const scope = <T>(action: (handles: FileHandle[], root: FileHandle) => Promise<T>) => withContent(root, action);
  return {
    async write(path: string, content: string) {
      const parts = visible(path, true);
      if (typeof content !== "string") return fail("Expected source text.");
      const bytes = Buffer.from(content);
      if (bytes.length > SOURCE_LIMITS.fileBytes) throw new AuthorError("too_large", "Source file exceeds 64 KiB.");
      return scope(async (handles, root) => {
        const parent = await directory(handles, root, parts.slice(0, -1), true);
        const target = child(parent, parts.at(-1)!);
        const checkTarget = async () => {
          try { safeFile(await lstat(target)); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        };
        await checkTarget();
        const temporary = child(parent, `.author-write-${randomUUID()}`);
        const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try {
          await file.writeFile(bytes);
          safeFile(await file.stat());
          await file.close();
          await checkTarget();
          // Replace the directory entry, never truncate an inode that could acquire another link.
          await rename(temporary, target);
        } finally { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
        return { path, size: bytes.length };
      });
    },
    async read(path: string, offset = 0, limit: number = SOURCE_LIMITS.readCharacters) {
      const parts = visible(path);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > SOURCE_LIMITS.readCharacters) return fail("Expected a bounded text range.");
      return scope(async (handles, root) => {
        const parent = await directory(handles, root, parts.slice(0, -1));
        const bytes = await readBytes(handles, parent, parts.at(-1)!);
        let text: string;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return fail("Source is not UTF-8 text."); }
        // Offsets count UTF-16 code units, matching ordinary JS strings.
        if (offset > text.length) return fail("Read offset exceeds source length.");
        const content = text.slice(offset, offset + limit), nextOffset = offset + content.length;
        return boundedOutput({ path, size: bytes.length, offset, nextOffset, eof: nextOffset === text.length, content });
      });
    },
    async list(path: string) {
      const parts = path === "" || path === "." ? [] : visible(path);
      return scope(async (handles, root) => {
        if (!parts.length) {
          // Inspect only public namespaces, never enumerate private content.
          const entries: { name: string; kind: "directory" }[] = [];
          for (const name of ["packages", "sources"]) {
            let stat;
            try { stat = await lstat(child(root, name)); }
            catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
            if (!stat.isDirectory()) throw new AuthorError("unsafe_source", "Source namespace must be a real directory.");
            entries.push({ name, kind: "directory" });
          }
          return boundedOutput({ path: "", entries });
        }
        const dir = await directory(handles, root, parts);
        const { opendir } = await import("node:fs/promises");
        const stream = await opendir(`/proc/self/fd/${dir.fd}`);
        const entries: { name: string; kind: "file" | "directory" }[] = [];
        for await (const item of stream) {
          relative(item.name);
          if (entries.length >= SOURCE_LIMITS.files) throw new AuthorError("too_large", "Directory exceeds 200 entries.");
          const stat = await lstat(child(dir, item.name));
          if (!stat.isDirectory()) safeFile(stat);
          entries.push({ name: item.name, kind: stat.isDirectory() ? "directory" : "file" });
        }
        return boundedOutput({ path, entries: entries.sort((a, b) => a.name.localeCompare(b.name)) });
      });
    },
    async snapshot(path: string): Promise<MaterialFile[]> {
      const parts = visible(path);
      return scope(async (handles, root) => {
        const dir = await directory(handles, root, parts);
        return snapshotFiles(handles, dir);
      });
    },
    /** Exclusive staging: never replace an existing stage, including after partial IO failure. */
    async stage(path: string, files: MaterialFile[], metadata: string) {
      const parts = visible(path);
      if (parts.length !== 2 || parts[0] !== "packages") return fail("Expected a package stage.");
      // Validate the expanded path before creating anything: staging adds one segment.
      for (const file of files) relative(`${path}/source/${file.path}`);
      return scope(async (handles, root) => {
        const parent = await directory(handles, root, ["packages"], true);
        await mkdir(child(parent, parts[1]), { mode: 0o700 });
        const stage = await directory(handles, parent, [parts[1]]);
        const source = await directory(handles, stage, ["source"], true);
        for (const file of files) {
          const parts = relative(file.path).split("/");
          const dir = await directory(handles, source, parts.slice(0, -1), true);
          try { await put(handles, dir, parts.at(-1)!, file.bytes); }
          finally { if (dir !== source) await dir.close(); }
        }
        await put(handles, stage, "provenance.json", Buffer.from(metadata));
      });
    },
  };
}
export type SourceFiles = ReturnType<typeof createSourceFiles>;
