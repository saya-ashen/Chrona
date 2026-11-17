import { dlopen, FFIType, ptr, read } from "bun:ffi";
import { randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rm, type FileHandle } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MODULE_SOURCE_MAX_BYTES, MODULE_SOURCE_MAX_FILES } from "../../../contracts/src/steward/module-material";
import { StewardError } from "../errors";

export type ModuleFile = { path: string; bytes: Uint8Array; executable?: boolean };
function validatePath(path: string) {
  if (!path || path.startsWith("/") || path.includes("\\") || Array.from(path).some(char => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127) || path.split("/").some(part => !part || part === "." || part === ".." || part === ".git" || part.includes(":"))) throw new StewardError("invalid", "Invalid module path");
  return path.split("/");
}
const unsafe = () => new StewardError("forbidden", "Unsafe module file");
/** Directory descriptors anchor traversal even when a caller renames/replaces a parent. */
function descriptor(handle: FileHandle) {
  if (process.platform === "linux") return `/proc/self/fd/${handle.fd}`;
  if (process.platform === "darwin") return `/dev/fd/${handle.fd}`;
  throw new StewardError("forbidden", "Safe module file traversal is unavailable on this host");
}
async function openDirectory(path: string) {
  try { return await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
  catch (error) { if (["ELOOP", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw unsafe(); throw error; }
}
async function createDirectory(path: string) {
  try { await mkdir(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}
async function readBoundedBytes(file: FileHandle, size: number) {
  // An extra byte detects growth without allocating an unbounded input.
  const bytes = Buffer.alloc(size + 1);
  let length = 0;
  while (length < bytes.length) {
    const read = await file.read(bytes, length, bytes.length - length, null);
    if (!read.bytesRead) break;
    length += read.bytesRead;
  }
  return bytes.subarray(0, length);
}
const regularFile = (stat: BigIntStats) => stat.isFile() && stat.nlink === 1n;
const sameFile = (a: BigIntStats, b: BigIntStats) => a.ino === b.ino && a.dev === b.dev;
const fingerprint = (stat: BigIntStats) => [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
function assertStableRead(start: BigIntStats, end: BigIntStats, current: BigIntStats, length: number) {
  if (BigInt(length) !== start.size || !regularFile(end) || !regularFile(current) || fingerprint(start) !== fingerprint(end) || fingerprint(start) !== fingerprint(current)) throw new StewardError("conflict", "Module file changed during snapshot");
}
/** Keep every selected file and its ancestors anchored until the complete read is verified. */
export class ModuleSnapshot {
  private directories = new Map<string, FileHandle>();
  private checks = new Map<string, () => Promise<boolean>>();
  async directory(path: string) {
    const cached = this.directories.get(path);
    if (cached) return cached;
    const before = await lstat(path, { bigint: true }), handle = await openDirectory(path);
    const current = await handle.stat({ bigint: true });
    if (!before.isDirectory() || !sameFile(before, current)) { await handle.close(); throw unsafe(); }
    this.directories.set(path, handle);
    this.checks.set(path, async () => sameFile(current, await lstat(path, { bigint: true })));
    return handle;
  }
  remember(path: string, stat: BigIntStats) {
    // Retain the first fingerprint even if the same path is read again.
    const key = `file:${path}`;
    if (!this.checks.has(key)) this.checks.set(key, async () => fingerprint(stat) === fingerprint(await lstat(path, { bigint: true })));
  }
  async verify() {
    for (const check of this.checks.values()) {
      let unchanged = false;
      try { unchanged = await check(); } catch { /* Disappearance is also a changed snapshot. */ }
      if (!unchanged) throw new StewardError("conflict", "Module material changed during snapshot");
    }
  }
  async close() { for (const handle of [...this.directories.values()].reverse()) await handle.close(); }
}
/** Linux RENAME_NOREPLACE publishes a whole private object without replacing even an empty winner. */
function publishDirectory(parent: FileHandle, temporary: string, destination: string) {
  for (const name of process.platform === "linux" ? ["libc.so.6", "libc.so"] : []) {
    let library;
    try { library = dlopen(name, {
      renameat2: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      __errno_location: { args: [], returns: FFIType.ptr },
    }); } catch { continue; }
    try {
      const from = Buffer.from(`${temporary}\0`), to = Buffer.from(`${destination}\0`);
      if (library.symbols.renameat2(parent.fd, ptr(from), parent.fd, ptr(to), 1) === 0) return;
      if (read.i32(library.symbols.__errno_location()!) === 17) return; // Caller verifies the complete existing winner.
      throw new StewardError("conflict", "Atomic artifact publication failed");
    } finally { library.close(); }
  }
  throw new StewardError("forbidden", "Atomic artifact publication is unavailable on this host");
}
export class ModuleDirectory {
  constructor(private handle: FileHandle, private snapshot?: ModuleSnapshot) {}
  async close() { if (!this.snapshot) await this.handle.close(); }
  async directory(path: string, create = false): Promise<ModuleDirectory> {
    const parts = validatePath(path);
    let parent = this.handle, owned: FileHandle | undefined;
    try {
      for (const part of parts) {
        const target = join(descriptor(parent), part);
        if (create) await createDirectory(target);
        const next = this.snapshot ? await this.snapshot.directory(target) : await openDirectory(target);
        if (!this.snapshot) await owned?.close();
        parent = owned = next;
      }
      return new ModuleDirectory(owned!, this.snapshot);
    } catch (error) { if (!this.snapshot) await owned?.close(); throw error; }
  }
  async entries() {
    const target = `${descriptor(this.handle)}/.`;
    if (this.snapshot) this.snapshot.remember(target, await this.handle.stat({ bigint: true }));
    return readdir(target, { withFileTypes: true });
  }
  async verifyTree(paths: Set<string>, prefix = "") {
    for (const entry of await this.entries()) {
      if (!prefix && INSTALLED_DIRS.has(entry.name) && entry.isDirectory()) continue;
      const path = prefix + entry.name;
      if (entry.isDirectory() && [...paths].some(selected => selected.startsWith(path + "/"))) {
        const child = await this.directory(entry.name);
        try { await child.verifyTree(paths, path + "/"); } finally { await child.close(); }
      } else if (!entry.isFile() || !paths.has(path)) throw new StewardError("conflict", "Installed material contains undeclared files");
    }
  }
  async read(path: string, limit: number): Promise<ModuleFile> {
    const parts = validatePath(path), name = parts.pop()!;
    const directory = parts.length ? await this.directory(parts.join("/")) : this;
    let file: FileHandle | undefined;
    try {
      const target = join(descriptor(directory.handle), name);
      const before = await lstat(target, { bigint: true });
      if (!regularFile(before)) throw unsafe();
      file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const start = await file.stat({ bigint: true });
      if (!regularFile(start) || !sameFile(start, before)) throw unsafe();
      if (start.size > BigInt(limit)) throw new StewardError("invalid", "Module exceeds file limits");
      const bytes = await readBoundedBytes(file, Number(start.size));
      const end = await file.stat({ bigint: true }), current = await lstat(target, { bigint: true });
      assertStableRead(start, end, current, bytes.length);
      this.snapshot?.remember(target, start);
      return { path, bytes, ...(start.mode & 0o111n ? { executable: true } : {}) };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ELOOP") throw unsafe(); throw error; }
    finally { await file?.close(); if (directory !== this) await directory.close(); }
  }
  /** Prepare and sync privately; only a complete object can become the public winner. */
  async publishImmutable(name: string, bytes: Uint8Array) {
    if (!/^[a-f0-9]{64}$/.test(name)) throw new StewardError("invalid", "Invalid artifact digest");
    const temporary = `.artifact-${randomUUID()}`, target = join(descriptor(this.handle), temporary);
    await mkdir(target, { mode: 0o700 });
    try {
      const directory = await this.directory(temporary);
      try {
        await directory.write({ path: "bytes", bytes }, 0o444);
        await directory.handle.sync();
      } finally { await directory.close(); }
      publishDirectory(this.handle, temporary, name);
      await this.handle.sync();
    } finally { await rm(target, { recursive: true, force: true }); }
  }
  async write(file: ModuleFile, mode = file.executable ? 0o755 : 0o644) {
    const parts = validatePath(file.path), name = parts.pop()!;
    const directory = parts.length ? await this.directory(parts.join("/"), true) : this;
    try {
      const handle = await open(join(descriptor(directory.handle), name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
      try { await handle.writeFile(file.bytes); await handle.chmod(mode); await handle.sync(); } finally { await handle.close(); }
    } finally { if (directory !== this) await directory.close(); }
  }
}
export async function openModuleDirectory(root: string, path?: string, create = false, snapshot?: ModuleSnapshot) {
  if (snapshot) {
    const base = resolve(root);
    const anchor = new ModuleDirectory(await snapshot.directory("/"), snapshot);
    const directory = base === "/" ? anchor : await anchor.directory(base.slice(1));
    return path ? directory.directory(path, create) : directory;
  }
  const base = resolve(root), before = await lstat(base);
  if (!before.isDirectory() || before.isSymbolicLink() || await realpath(base) !== base) throw unsafe();
  const handle = await openDirectory(base), current = await handle.stat();
  if (current.ino !== before.ino || current.dev !== before.dev) { await handle.close(); throw unsafe(); }
  const directory = new ModuleDirectory(handle);
  if (!path) return directory;
  try { return await directory.directory(path, create); } finally { await directory.close(); }
}
/** Installed by Chrona, never submitted, hashed or shown in source diffs. */
export const INSTALLED_DIRS = new Set(["node_modules", ".venv", ".chrona"]);
export async function snapshotModule(root: string, path: string): Promise<ModuleFile[]> {
  const directory = await openModuleDirectory(root, path), files: ModuleFile[] = [];
  let total = 0;
  async function walk(dir: ModuleDirectory, prefix: string): Promise<void> {
    for (const entry of await dir.entries()) {
      if (!prefix && (entry.name === ".git" || INSTALLED_DIRS.has(entry.name))) continue;
      validatePath(entry.name);
      const relative = prefix + entry.name;
      if (entry.isDirectory()) {
        const child = await dir.directory(entry.name);
        try { await walk(child, relative + "/"); } finally { await child.close(); }
      } else {
        if (files.length >= MODULE_SOURCE_MAX_FILES) throw new StewardError("invalid", "Module exceeds file limits");
        const file = await dir.read(entry.name, MODULE_SOURCE_MAX_BYTES - total);
        total += file.bytes.byteLength;
        // Preserve the legacy snapshot/hash representation.
        files.push({ path: relative, bytes: file.bytes });
      }
    }
  }
  try { await walk(directory, ""); } finally { await directory.close(); }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export async function checkoutModule(root: string, path: string, files: ModuleFile[]) {
  // Validate every path before creating anything.
  const seen = new Set<string>();
  for (const file of files) {
    validatePath(file.path);
    if (seen.has(file.path)) throw new StewardError("invalid", "Duplicate module file");
    seen.add(file.path);
  }
  const directory = await openModuleDirectory(root, path, true);
  try {
    if ((await directory.entries()).length) throw new StewardError("conflict", "Checkout directory must be empty");
    for (const file of files) await directory.write(file);
  } finally { await directory.close(); }
}
