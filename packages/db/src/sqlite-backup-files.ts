import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ensurePrivateDirectory, secureGeneratedPrivateFile } from "./sqlite-url";

export const backupDataRoots = ["platform", "sessions", "secrets", "qq-bot"] as const;

// Installed module dependencies are reproducible, and may contain package-manager symlinks.
const installedDirs = ["node_modules", ".venv", ".chrona"];
function assertRegularTree(dataDir: string, path: string, files: string[]): void {
  const stat = lstatSync(join(dataDir, path));
  const parts = path.split("/");
  if (stat.isDirectory() && parts.length === 4 && parts[0] === "platform" && parts[1] === "store" && installedDirs.includes(parts[3]!)) return;
  if (!stat.isDirectory() && !stat.isFile()) {
    throw new Error("Backup refuses symlinks and special files in platform, sessions, secrets or qq-bot.");
  }
  files.push(path);
  if (stat.isDirectory()) for (const name of readdirSync(join(dataDir, path))) assertRegularTree(dataDir, `${path}/${name}`, files);
}

export function backupDataFiles(dataDir: string, archivePath: string): void {
  if (existsSync(archivePath)) throw new Error("Backup archive already exists.");
  const present = backupDataRoots.filter(root => lstatSync(join(dataDir, root), { throwIfNoEntry: false }) !== undefined);
  const files: string[] = [];
  for (const root of present) {
    if (!lstatSync(join(dataDir, root)).isDirectory()) throw new Error("Backup roots must be directories.");
    assertRegularTree(dataDir, root, files);
  }
  // Reserve a private output before tar opens it, including under a permissive umask.
  writeFileSync(archivePath, "", { flag: "wx", mode: 0o600 });
  execFileSync("tar", ["--format=ustar", "--hard-dereference", "--no-recursion", "-cf", resolve(archivePath), "-C", resolve(dataDir), "--null", "--files-from=-"], { input: files.length ? `${files.join("\0")}\0` : "", stdio: "pipe" });
  secureGeneratedPrivateFile(archivePath);
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
