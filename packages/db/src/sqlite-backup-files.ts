import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { ensurePrivateDirectory, secureGeneratedPrivateFile } from "./sqlite-url";

export const backupDataRoots = ["platform", "sessions", "secrets"] as const;

// Installed module dependencies are reproducible, and may contain package-manager symlinks.
const installedDirs = ["node_modules", ".venv", ".chrona"];
// Installed module dependencies, and dependencies or browser profiles in session work directories.
function isReproducibleDirectory(parts: string[]): boolean {
  if (parts.length === 4 && parts[0] === "platform" && parts[1] === "store") return installedDirs.includes(parts[3]!);
  if (parts[0] !== "sessions" || parts.length < 2) return false;
  const name = parts[parts.length - 1]!;
  return name === "node_modules" || name === ".venv" || name.startsWith(".chrome-");
}

// Links and special files cannot be archived. In platform and sessions they point outside the data or are recreated
// (gcroots and package-manager bins), so they are left out and listed; credential roots refuse them.
function assertRegularTree(dataDir: string, path: string, files: string[], omitted: string[]): void {
  const stat = lstatSync(join(dataDir, path));
  const parts = path.split("/");
  if (stat.isDirectory() && isReproducibleDirectory(parts)) return;
  if (!stat.isDirectory() && !stat.isFile()) {
    if (parts[0] === "platform" || parts[0] === "sessions") { omitted.push(path); return; }
    throw new Error("Backup refuses symlinks and special files in secrets.");
  }
  files.push(path);
  if (stat.isDirectory()) for (const name of readdirSync(join(dataDir, path))) assertRegularTree(dataDir, `${path}/${name}`, files, omitted);
}

// ustar stores UTF-8 paths in a 100-byte name and an optional 155-byte directory prefix.
function archivePathFields(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  for (let split = path.lastIndexOf("/"); split > 0; split = path.lastIndexOf("/", split - 1)) {
    const prefix = path.slice(0, split), name = path.slice(split + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Error(`Backup path exceeds ustar limits: ${path}`);
}

function archiveHeader(path: string, directory: boolean, size: number, executable: boolean): Buffer {
  const { name, prefix } = archivePathFields(path);
  if (!Number.isSafeInteger(size) || size < 0 || size > 0o77777777777) throw new Error("Backup file exceeds ustar size limits.");
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write(prefix, 345, 155);
  header.write(`${(directory || executable ? 0o700 : 0o600).toString(8).padStart(7, "0")}\0`, 100);
  header.write("0000000\0", 108); // No host user/group identity is needed for private restores.
  header.write("0000000\0", 116);
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  header.write("00000000000\0", 136);
  header.fill(32, 148, 156);
  header[156] = directory ? 53 : 48;
  header.write("ustar\0", 257);
  header.write("00", 263);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
  return header;
}

function writeArchiveEntry(output: number, dataDir: string, path: string, buffer: Buffer, snapshot?: string): void {
  const source = snapshot ?? join(dataDir, path), stat = lstatSync(source);
  if (stat.isDirectory()) {
    writeFileSync(output, archiveHeader(path, true, 0, false));
    return;
  }
  if (!stat.isFile()) throw new Error("Backup source is no longer a regular file.");
  // POSIX flags prevent following a final symlink or blocking on a FIFO swapped in after traversal.
  const flags = process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  const input = openSync(source, flags);
  try {
    const opened = fstatSync(input);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) throw new Error("Backup source changed while opening.");
    writeFileSync(output, archiveHeader(path, false, opened.size, Boolean(opened.mode & 0o111)));
    let remaining = opened.size;
    while (remaining > 0) {
      const count = readSync(input, buffer, 0, Math.min(remaining, buffer.length), null);
      if (count === 0) throw new Error("Backup source changed while reading.");
      writeFileSync(output, buffer.subarray(0, count));
      remaining -= count;
    }
    const after = fstatSync(input);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error("Backup source changed while reading.");
    writeFileSync(output, Buffer.alloc((512 - opened.size % 512) % 512));
  } finally { closeSync(input); }
}

/** Private databases may still have committed WAL pages after process exit. Archive a
 * checked SQLite snapshot instead of copying a main file separately from its WAL. */
function snapshotDatabases(dataDir: string, files: string[], stage: string) {
  const snapshots = new Map<string, string>();
  for (const path of files) {
    const source = join(dataDir, path);
    if (!lstatSync(source).isFile() || !path.startsWith("platform/data/") || !/\.(db|sqlite|sqlite3)$/i.test(path)) continue;
    const destination = join(stage, String(snapshots.size));
    const db = new Database(source, { readonly: true });
    try { db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`); }
    finally { db.close(); }
    const snapshot = new Database(destination, { readonly: true });
    try {
      const checks = snapshot.query("PRAGMA quick_check").all() as { quick_check: string }[];
      if (checks.length !== 1 || checks[0]?.quick_check !== "ok") throw new Error(`SQLite backup integrity check failed: ${path}`);
    } finally { snapshot.close(); }
    snapshots.set(path, destination);
  }
  return snapshots;
}

/** Returns the links and special files left out of the archive. */
export function backupDataFiles(dataDir: string, archivePath: string): string[] {
  if (existsSync(archivePath)) throw new Error("Backup archive already exists.");
  const present = backupDataRoots.filter(root => lstatSync(join(dataDir, root), { throwIfNoEntry: false }) !== undefined);
  const files: string[] = [], omitted: string[] = [];
  for (const root of present) {
    if (!lstatSync(join(dataDir, root)).isDirectory()) throw new Error("Backup roots must be directories.");
    assertRegularTree(dataDir, root, files, omitted);
  }
  const seen = new Set<string>();
  for (const path of files) {
    if (!safePath(path, lstatSync(join(dataDir, path)).isDirectory(), seen)) throw new Error(`Invalid or unsafe backup path: ${path}`);
    seen.add(path);
    archivePathFields(path);
  }
  // Secure the exclusively created output before writing any content, including on Windows.
  const output = openSync(archivePath, "wx", 0o600);
  let stage: string | undefined;
  try {
    secureGeneratedPrivateFile(archivePath);
    const buffer = Buffer.alloc(64 * 1024);
    stage = mkdtempSync(join(dirname(archivePath), ".sqlite-snapshots-"));
    const snapshots = snapshotDatabases(dataDir, files, stage);
    for (const path of files) {
      const main = path.replace(/-(wal|shm|journal)$/, "");
      if (main !== path && snapshots.has(main)) continue;
      writeArchiveEntry(output, dataDir, path, buffer, snapshots.get(path));
    }
    writeFileSync(output, Buffer.alloc(1024));
  } catch (error) {
    rmSync(archivePath, { force: true });
    throw error;
  } finally {
    closeSync(output);
    if (stage) rmSync(stage, { recursive: true, force: true });
  }
  return omitted;
}

type Entry = { path: string; directory: boolean; executable: boolean; content: Buffer };

function safePath(path: string, directory: boolean, seen: Set<string>): boolean {
  const parts = path.split("/");
  return backupDataRoots.includes(parts[0] as typeof backupDataRoots[number])
    && !parts.some(part => !part || part === "." || part === ".." || part.includes("\\"))
    && !seen.has(path) && (parts.length > 1 || directory);
}

function safeHeader(header: Buffer, sizeText: string, size: number, remaining: number): boolean {
  const checksum = Number.parseInt(header.subarray(148, 156).toString().split("\0")[0]!.trim(), 8);
  const actual = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
  return checksum === actual && header.subarray(257, 262).toString() === "ustar"
    && /^[0-7]+$/.test(sizeText) && Number.isSafeInteger(size) && size >= 0 && size <= remaining
    && [0, 48, 53].includes(header[156]!) && (header[156] !== 53 || size === 0);
}

/** Only our portable ustar regular files/directories are accepted; no links or extensions. */
function entries(archivePath: string): Entry[] {
  const bytes = readFileSync(archivePath);
  const result: Entry[] = [];
  const seen = new Set<string>();
  let offset = 0;
  const text = (header: Buffer, start: number, length: number) => header.subarray(start, start + length).toString("utf8").split("\0")[0]!;
  for (; offset + 512 <= bytes.length; ) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const sizeText = text(header, 124, 12).trim();
    const size = Number.parseInt(sizeText, 8);
    const type = header[156];
    const prefix = text(header, 345, 155);
    const path = `${prefix ? `${prefix}/` : ""}${text(header, 0, 100)}`.replace(/\/$/, "");
    if (!safeHeader(header, sizeText, size, bytes.length - offset - 512) || !safePath(path, type === 53, seen)) {
      throw new Error("Invalid or unsafe Chrona data archive.");
    }
    seen.add(path);
    result.push({ path, directory: type === 53, executable: Boolean(Number.parseInt(text(header, 100, 8), 8) & 0o111), content: bytes.subarray(offset + 512, offset + 512 + size) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (bytes.length < offset + 1024 || !bytes.subarray(offset).every(byte => byte === 0)) throw new Error("Truncated Chrona data archive.");
  return result;
}

export function stageDataFiles(dataDir: string, archivePath: string): string {
  const files = entries(archivePath); // Validate everything before touching the destination.
  ensurePrivateDirectory(dataDir);
  const stage = mkdtempSync(join(dataDir, ".restore-files-"));
  try {
    for (const root of backupDataRoots) mkdirSync(join(stage, root), { mode: 0o700 });
    for (const file of files) {
      const target = join(stage, file.path);
      if (file.directory) mkdirSync(target, { recursive: true, mode: 0o700 });
      else {
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
        writeFileSync(target, file.content, { flag: "wx", mode: file.executable ? 0o700 : 0o600 });
      }
    }
    return stage;
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

/** Preserve prior directories next to the staging directory; roll back ordinary failures. */
export function replaceDataFiles(dataDir: string, stage: string, restoreDatabase: () => void): void {
  const installed: string[] = [];
  const retired: string[] = [];
  try {
    for (const root of backupDataRoots) {
      const target = join(dataDir, root);
      if (lstatSync(target, { throwIfNoEntry: false })) {
        renameSync(target, `${stage}-prior-${root}`);
        retired.push(root);
      }
      renameSync(join(stage, root), target);
      installed.push(root);
    }
    restoreDatabase();
  } catch (error) {
    for (const root of installed.reverse()) renameSync(join(dataDir, root), join(stage, root));
    for (const root of retired.reverse()) renameSync(`${stage}-prior-${root}`, join(dataDir, root));
    throw error;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
