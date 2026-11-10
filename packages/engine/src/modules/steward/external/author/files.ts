import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink, opendir, rm, type FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, resolve, sep } from "node:path";
import { AuthorError, fail, relative, sourceDir, submitDir } from "./contracts";
import { digest, MATERIAL_LIMITS, MATERIAL_RECORD, parseMaterialRecord, SOURCE_LIMITS, validateMaterial, materialSummary, type ImportMaterial, type MaterialRecord, type MaterialFile } from "./material";
import { publishDirectory } from "./publish";
export { SOURCE_LIMITS } from "./material";
export type { MaterialFile } from "./material";
const safeFile = (stat: { isFile(): boolean; nlink: number | bigint }) => {
  if (!stat.isFile() || BigInt(stat.nlink) !== 1n) throw new AuthorError("unsafe_source", "Material must be a regular file with one link.");
};
const boundedOutput = <T>(value: T): T => {
  if (Buffer.byteLength(JSON.stringify(value)) > SOURCE_LIMITS.outputBytes) throw new AuthorError("too_large", "Source result exceeds the output limit; select a smaller directory or read range.");
  return value;
};
const child = (parent: FileHandle, part: string) => `/proc/self/fd/${parent.fd}/${part}`;
const fingerprint = (stat: BigIntStats) => [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
type Scope = { handles: FileHandle[]; checks: (() => Promise<void>)[] };
async function unchanged(scope: Scope) { for (const check of scope.checks) await check(); }
async function anchoredDirectory(scope: Scope, parent: FileHandle, part: string): Promise<FileHandle> {
  const path = child(parent, part);
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  scope.handles.push(handle);
  const before = await handle.stat({ bigint: true });
  // Check identity rather than timestamps here: directory writes by this operation are allowed.
  scope.checks.push(async () => {
    const now = await lstat(path, { bigint: true });
    if (!now.isDirectory() || now.ino !== before.ino || now.dev !== before.dev) throw new AuthorError("conflict", "Material directory changed during access.");
  });
  return handle;
}
async function absoluteDirectory(scope: Scope, path: string): Promise<FileHandle> {
  if (await realpath(path) !== path) throw new AuthorError("unsafe_source", "Material root must have no symlink components.");
  const root = await open(sep, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  scope.handles.push(root);
  return directory(scope, root, path.split(sep).filter(Boolean));
}
async function directory(scope: Scope, start: FileHandle, parts: string[], create = false): Promise<FileHandle> {
  let current = start;
  for (const part of parts) {
    if (create) await mkdir(child(current, part), { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    current = await anchoredDirectory(scope, current, part);
  }
  return current;
}
async function io<T>(action: (scope: Scope) => Promise<T>): Promise<T> {
  const scope: Scope = { handles: [], checks: [] };
  try { return await action(scope); }
  catch (error) {
    if (error instanceof AuthorError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new AuthorError("not_found", "Material path not found.");
    throw new AuthorError("source_io", "Material operation failed: missing, occupied, or unsafe path.");
  } finally { for (const handle of scope.handles.reverse()) await handle.close().catch(() => {}); }
}
async function readBytes(scope: Scope, parent: FileHandle, part: string, max: number = SOURCE_LIMITS.fileBytes): Promise<MaterialFile> {
  const path = child(parent, part);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    safeFile(before);
    if (before.size > BigInt(max)) throw new AuthorError("too_large", "Material file exceeds its byte limit.");
    // Bound allocation and reads independently of a concurrently changing size.
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await file.read(buffer, length, buffer.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await file.stat({ bigint: true });
    safeFile(after);
    if (fingerprint(after) !== fingerprint(before) || BigInt(length) !== before.size) throw new AuthorError("conflict", "Material changed while reading.");
    scope.checks.push(async () => {
      if (fingerprint(await lstat(path, { bigint: true })) !== fingerprint(before)) throw new AuthorError("conflict", "Material changed during snapshot.");
    });
    return { path: part, bytes: buffer.subarray(0, length), executable: (before.mode & 0o111n) !== 0n };
  } finally { await file.close(); }
}
function visible(path: string, writing = false) {
  const parts = relative(path).split("/");
  if (parts.slice(2).some(part => ["node_modules", ".venv", ".chrona"].includes(part))) return fail("Use submitted source files outside installed dependency directories.");
  if (!["sources", "packages"].includes(parts[0]) || (writing && (parts[0] !== "sources" || parts.length < 3))) return fail("Use source files under sources/<workspace>; packages are read-only.");
  if (parts.length > 1 && !/^[a-z][a-z0-9-]{0,63}$/.test(parts[1])) return fail("Expected a bounded workspace name.");
  return parts;
}
async function put(parent: FileHandle, part: string, file: MaterialFile) {
  const handle = await open(child(parent, part), constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_EXCL, 0o600);
  try {
    safeFile(await handle.stat());
    await handle.writeFile(file.bytes);
    // Normalize to private read/write plus the portable executable bit only.
    await handle.chmod(file.executable ? 0o700 : 0o600);
  } finally { await handle.close(); }
}
async function copyFiles(scope: Scope, root: FileHandle, files: MaterialFile[]) {
  for (const file of files) {
    const parts = relative(file.path).split("/");
    const parent = await directory(scope, root, parts.slice(0, -1), true);
    await put(parent, parts.at(-1)!, file);
  }
}
async function snapshotFiles(scope: Scope, root: FileHandle): Promise<MaterialFile[]> {
  let record: MaterialRecord | undefined;
  let recordStat;
  try { recordStat = await lstat(child(root, MATERIAL_RECORD)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  // Once observed, a vanished record fails rather than downgrading the limits.
  if (recordStat) {
    safeFile(recordStat);
    record = parseMaterialRecord((await readBytes(scope, root, MATERIAL_RECORD, MATERIAL_LIMITS.recordBytes)).bytes);
  }
  const limits = record ? MATERIAL_LIMITS : SOURCE_LIMITS;
  const artifacts = new Set(record?.artifacts.map(file => file.path));
  const files: MaterialFile[] = [];
  let entries = 0, total = 0;
  async function visit(parent: FileHandle, prefix: string) {
    const before = fingerprint(await parent.stat({ bigint: true }));
    for await (const item of await opendir(`/proc/self/fd/${parent.fd}`)) {
      if (++entries > limits.entries) throw new AuthorError("too_large", "Material tree exceeds the entry limit.");
      const path = relative(prefix + item.name);
      const stat = await lstat(child(parent, item.name));
      if (stat.isDirectory()) {
        const dir = await anchoredDirectory(scope, parent, item.name);
        await visit(dir, `${path}/`);
      } else {
        safeFile(stat);
        if (files.length >= limits.files) throw new AuthorError("too_large", "Material tree exceeds the file count limit.");
        const max = artifacts.has(path) ? MATERIAL_LIMITS.fileBytes : path === MATERIAL_RECORD ? MATERIAL_LIMITS.recordBytes : record ? SOURCE_LIMITS.totalBytes : SOURCE_LIMITS.fileBytes;
        const file = await readBytes(scope, parent, item.name, Math.min(max, limits.totalBytes - total));
        total += file.bytes.length;
        files.push({ ...file, path });
      }
    }
    scope.checks.push(async () => {
      if (fingerprint(await parent.stat({ bigint: true })) !== before) throw new AuthorError("conflict", "Material directory changed during snapshot.");
    });
  }
  await visit(root, "");
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  validateMaterial(files);
  await unchanged(scope);
  return files;
}
/** Create an invisible sibling, then atomically publish without replacing any entry.
 * Cleanup is anchored to the parent and only removes the inode this operation created. */
async function publish(scope: Scope, parent: FileHandle, target: string, write: (temporary: FileHandle) => Promise<void>) {
  const temporary = `.author-material-${randomUUID()}`;
  const path = child(parent, temporary);
  await mkdir(path, { mode: 0o700 });
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  scope.handles.push(handle);
  const own = await handle.stat({ bigint: true });
  let published = false;
  try {
    await write(handle);
    await unchanged(scope);
    const now = await lstat(path, { bigint: true });
    if (now.ino !== own.ino || now.dev !== own.dev || !now.isDirectory()) throw new AuthorError("conflict", "Material staging directory changed.");
    publishDirectory(parent, temporary, target);
    published = true;
  } finally {
    if (!published) {
      const now = await lstat(path, { bigint: true }).catch(() => undefined);
      if (now?.ino === own.ino && now.dev === own.dev && now.isDirectory()) await rm(path, { recursive: true, force: true });
    }
  }
}
const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}${sep}`) || b.startsWith(`${a}${sep}`);

type SourceScope = <T>(action: (scope: Scope, root: FileHandle) => Promise<T>) => Promise<T>;
function materialTransfers(scope: SourceScope, external: (path: string) => void) {
  return {
    async import(input: ImportMaterial) {
      external(input.from);
      const parts = sourceDir(input.to).split("/");
      // Validate expanded paths before allocating or publishing anything.
      for (const path of [...input.source, ...input.artifacts.map(file => file.path), MATERIAL_RECORD]) relative(`${input.to}/${path}`);
      return scope(async (scope, root) => {
        const from = await absoluteDirectory(scope, input.from);
        const files: MaterialFile[] = [];
        let total = 0, sourceBytes = 0;
        for (const selected of [...input.source.map(path => ({ path, source: true })), ...input.artifacts.map(file => ({ ...file, source: false }))]) {
          const path = relative(selected.path).split("/");
          const parent = await directory(scope, from, path.slice(0, -1));
          const max = selected.source ? SOURCE_LIMITS.totalBytes : MATERIAL_LIMITS.fileBytes;
          const file = await readBytes(scope, parent, path.at(-1)!, Math.min(max, MATERIAL_LIMITS.totalBytes - total));
          if (!selected.source && Boolean(file.executable) !== Boolean("executable" in selected && selected.executable)) throw new AuthorError("conflict", "Selected artifact executable flag must match the workspace mode.");
          total += file.bytes.length;
          if (selected.source) sourceBytes += file.bytes.length;
          if (sourceBytes > SOURCE_LIMITS.totalBytes) throw new AuthorError("too_large", "Selected sources exceed 1 MiB.");
          files.push({ ...file, path: selected.path });
        }
        const record: MaterialRecord = { schema: 1, source: input.source, artifacts: input.artifacts.map(artifact => ({ ...artifact, sha256: digest(files.find(file => file.path === artifact.path)!.bytes) })), build: input.build };
        files.push({ path: MATERIAL_RECORD, bytes: Buffer.from(`${JSON.stringify(record, null, 2)}\n`) });
        validateMaterial(files);
        const parent = await directory(scope, root, ["sources"], true);
        await publish(scope, parent, parts[1], temporary => copyFiles(scope, temporary, files));
        return { path: input.to, record: `${input.to}/${MATERIAL_RECORD}`, ...materialSummary(files) };
      });
    },
    async export(path: string, to: string) {
      external(to);
      const parts = submitDir(path).split("/");
      return scope(async (scope, root) => {
        const files = await snapshotFiles(scope, await directory(scope, root, parts));
        const parent = await absoluteDirectory(scope, dirname(to));
        await publish(scope, parent, basename(to), temporary => copyFiles(scope, temporary, files));
        return { path, to, ...materialSummary(files) };
      });
    },
  };
}

/** Explicit workspace paths are trusted-local material inputs, never Run identity.
 * Private roots come from the SDK, not caller arguments or a host-session layout. */
export function createSourceFiles(content: string, privateRoots: string[] = []) {
  const root = resolve(content);
  const privatePaths = [root, ...privateRoots.map(path => resolve(path))];
  function external(path: string) {
    if (privatePaths.some(privatePath => overlaps(path, privatePath))) return fail("Workspace must be separate from private application storage.");
  }
  const scope = <T>(action: (scope: Scope, root: FileHandle) => Promise<T>) => io(async scope => action(scope, await absoluteDirectory(scope, root)));
  return {
    async write(path: string, content: string) {
      const parts = visible(path, true);
      if (typeof content !== "string") return fail("Expected source text.");
      const bytes = Buffer.from(content);
      if (bytes.length > SOURCE_LIMITS.fileBytes) throw new AuthorError("too_large", "Source file exceeds 64 KiB.");
      return scope(async (scope, root) => {
        const parent = await directory(scope, root, parts.slice(0, -1), true);
        const target = child(parent, parts.at(-1)!);
        const checkTarget = async () => {
          try { const stat = await lstat(target); safeFile(stat); return (stat.mode & 0o111) !== 0; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return false; }
        };
        await checkTarget();
        const temporary = child(parent, `.author-write-${randomUUID()}`);
        const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try {
          await file.writeFile(bytes);
          safeFile(await file.stat());
          const executable = await checkTarget();
          await file.chmod(executable ? 0o700 : 0o600);
          await unchanged(scope);
          await rename(temporary, target);
        } finally { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
        return { path, size: bytes.length };
      });
    },
    async read(path: string, offset = 0, limit: number = SOURCE_LIMITS.readCharacters) {
      const parts = visible(path);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > SOURCE_LIMITS.readCharacters) return fail("Expected a bounded text range.");
      return scope(async (scope, root) => {
        const parent = await directory(scope, root, parts.slice(0, -1));
        const { bytes } = await readBytes(scope, parent, parts.at(-1)!);
        await unchanged(scope);
        let text: string;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return fail("Source is not UTF-8 text."); }
        if (offset > text.length) return fail("Read offset exceeds source length.");
        const content = text.slice(offset, offset + limit), nextOffset = offset + content.length;
        return boundedOutput({ path, size: bytes.length, offset, nextOffset, eof: nextOffset === text.length, content });
      });
    },
    async list(path: string) {
      const parts = path === "" || path === "." ? [] : visible(path);
      return scope(async (scope, root) => {
        if (!parts.length) {
          const entries: { name: string; kind: "directory" }[] = [];
          for (const name of ["packages", "sources"]) {
            let stat;
            try { stat = await lstat(child(root, name)); }
            catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
            if (!stat.isDirectory()) throw new AuthorError("unsafe_source", "Source namespace must be a real directory.");
            entries.push({ name, kind: "directory" });
          }
          await unchanged(scope);
          return boundedOutput({ path: "", entries });
        }
        const dir = await directory(scope, root, parts);
        const entries: { name: string; kind: "file" | "directory" }[] = [];
        for await (const item of await opendir(`/proc/self/fd/${dir.fd}`)) {
          // Operation-owned hidden staging directories are never public material.
          if (item.name.startsWith(".author-material-")) continue;
          relative(item.name);
          if (entries.length >= SOURCE_LIMITS.files) throw new AuthorError("too_large", "Directory exceeds 200 entries.");
          const stat = await lstat(child(dir, item.name));
          if (!stat.isDirectory()) safeFile(stat);
          entries.push({ name: item.name, kind: stat.isDirectory() ? "directory" : "file" });
        }
        await unchanged(scope);
        return boundedOutput({ path, entries: entries.sort((a, b) => a.name.localeCompare(b.name)) });
      });
    },
    async snapshot(path: string): Promise<MaterialFile[]> {
      const parts = visible(path);
      return scope(async (scope, root) => snapshotFiles(scope, await directory(scope, root, parts)));
    },
    ...materialTransfers(scope, external),
    /** Whole-stage atomic publication; no existing destination is ever replaced. */
    async stage(path: string, files: MaterialFile[], metadata: string) {
      const parts = visible(path);
      if (parts.length !== 2 || parts[0] !== "packages") return fail("Expected a package stage.");
      for (const file of files) relative(`${path}/source/${file.path}`);
      validateMaterial(files);
      if (Buffer.byteLength(metadata) > MATERIAL_LIMITS.recordBytes) throw new AuthorError("too_large", "Package provenance exceeds 1 MiB.");
      return scope(async (scope, root) => {
        const parent = await directory(scope, root, ["packages"], true);
        await publish(scope, parent, parts[1], async temporary => {
          await mkdir(child(temporary, "source"), { mode: 0o700 });
          const source = await directory(scope, temporary, ["source"]);
          await copyFiles(scope, source, files);
          await put(temporary, "provenance.json", { path: "provenance.json", bytes: Buffer.from(metadata) });
        });
      });
    },
  };
}
export type SourceFiles = ReturnType<typeof createSourceFiles>;
