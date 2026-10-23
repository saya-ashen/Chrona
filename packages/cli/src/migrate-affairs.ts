import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, closeSync, constants, copyFileSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { acquireSqliteRuntimeLock } from "@chrona/db/sqlite-runtime-lock";

function digest(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(fd).isFile()) throw new Error("Expected a regular backup or content file.");
    const hash = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024);
    let length: number;
    while ((length = readSync(fd, buffer)) > 0) hash.update(buffer.subarray(0, length));
    return hash.digest("hex");
  } finally { closeSync(fd); }
}
const stat = (path: string) => lstatSync(path, { throwIfNoEntry: false });
const executable = /\.(?:[cm]?[jt]sx?|sh|bash|zsh|fish|py|rb|pl|php|exe|dll|com|bat|cmd|ps1|vbs|msi|scr|jar|wasm|app|desktop)$/i;

// Metadata only: never follow symlinks or inspect private .chrona contents.
function affairFingerprint(dataDir: string): string {
  const hash = createHash("sha256");
  function walk(path: string, relative: string) {
    const info = stat(path);
    if (!info) return;
    hash.update(JSON.stringify([relative, info.mode, info.size, info.mtimeMs, info.ctimeMs]));
    if (info.isDirectory()) for (const name of readdirSync(path).sort()) walk(join(path, name), `${relative}/${name}`);
  }
  walk(join(dataDir, "affairs"), "affairs");
  return hash.digest("hex");
}

/** Additional CLI backup evidence; old backups must be regenerated before migration. */
export function recordAffairBackup(databaseUrl: string, dataDir: string, backup: string): void {
  const lock = acquireSqliteRuntimeLock(databaseUrl);
  try {
    const archive = `${backup}.affairs.tar`;
    if (resolve(backup).startsWith(`${resolve(dataDir, "affairs")}/`)) throw new Error("Backup must be outside the affairs directory.");
    const fingerprint = affairFingerprint(dataDir);
    writeFileSync(archive, "", { flag: "wx", mode: 0o600 });
    execFileSync("tar", ["--format=posix", "-cf", archive, "-C", resolve(dataDir),
      ...(stat(join(dataDir, "affairs")) ? ["affairs"] : ["--files-from=/dev/null"])], { stdio: "pipe" });
    if (fingerprint !== affairFingerprint(dataDir)) throw new Error("Affairs changed during backup; create a new backup.");
    writeFileSync(`${backup}.chrona-backup.json`, JSON.stringify({
      format: "chrona-backup-v1", createdAt: new Date().toISOString(), dataDir: resolve(dataDir),
      databasePath: lock.databasePath, databaseHash: digest(backup), archiveHash: digest(`${backup}.tar`),
      affairsHash: digest(archive), affairFingerprint: fingerprint,
    }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  } finally { lock.release(); }
}

function requireBackup(backup: string | undefined, databasePath: string, dataDir: string): string {
  const message = "A fresh --backup <file> created by chrona backup is required; run chrona backup with the server stopped.";
  if (!backup) throw new Error(message);
  const path = resolve(backup);
  try {
    const evidence = JSON.parse(readFileSync(`${path}.chrona-backup.json`, "utf8"));
    if (path === databasePath || evidence.format !== "chrona-backup-v1" || evidence.databasePath !== databasePath
      || evidence.dataDir !== resolve(dataDir) || evidence.databaseHash !== digest(path)
      || evidence.archiveHash !== digest(`${path}.tar`) || evidence.affairsHash !== digest(`${path}.affairs.tar`)
      || evidence.affairFingerprint !== affairFingerprint(dataDir)) throw new Error(message);
  } catch { throw new Error(message); }
  return path;
}

function safePart(value: string): boolean {
  return Boolean(value) && value !== "." && value !== ".." && !/[\\/\x00-\x1f]/.test(value);
}
function folderTitle(title: string): string {
  return title.normalize("NFC").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").slice(0, 100) || "Untitled";
}

// Validate every existing ancestor, including destinations, before reading or copying.
function safeDirectory(path: string, create = false): void {
  let current = parse(resolve(path)).root;
  for (const part of resolve(path).slice(current.length).split("/")) {
    current = join(current, part);
    let info = stat(current);
    if (!info && create) { mkdirSync(current, { mode: 0o700 }); info = stat(current); }
    if (info && !info.isDirectory()) throw new Error(`Unsafe directory: ${current}`);
  }
}

function connectorMappings(backup: string): Map<string, Set<string>> {
  const db = new Database(backup, { readonly: true });
  try {
    const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    if (!tables.some(row => row.name === "Affair") || !tables.some(row => row.name === "Connector")) return new Map();
    const rows = db.query('SELECT a.dirName, c.id FROM Connector c JOIN Affair a ON a.id = c.affairId').all() as { dirName: string; id: string }[];
    const result = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!safePart(row.id)) continue;
      const ids = result.get(row.dirName) ?? new Set<string>(); ids.add(row.id); result.set(row.dirName, ids);
    }
    return result;
  } finally { db.close(); }
}

type FileReport = { source: string; target: string; action: "copy" | "exists" | "conflict"; copied: boolean };
type AffairReport = { directory: string; title: string; titleSource: "README.md first heading" | "directory name"; target: string; filesToCopy: number; files: FileReport[]; skipped: { path: string; reason: string }[] };

export function migrateAffairs(databaseUrl: string, dataDir: string, options: { backup?: string; apply?: boolean }) {
  const lock = acquireSqliteRuntimeLock(databaseUrl);
  try {
    const backup = requireBackup(options.backup, lock.databasePath, dataDir);
    const db = new Database(lock.databasePath, { readonly: true });
    let modules: { id: string }[];
    try { modules = db.query("SELECT id FROM Module WHERE name = 'files' AND builtin = 1").all() as { id: string }[]; }
    finally { db.close(); }
    if (modules.length !== 1 || !safePart(modules[0]!.id)) throw new Error("Expected exactly one built-in files module. Install/initialize the files module before migrating affairs.");
    const root = join(dataDir, "platform", "content", modules[0]!.id);
    const sourceRoot = join(dataDir, "affairs");
    safeDirectory(sourceRoot); safeDirectory(root);
    const mappings = connectorMappings(backup);
    const used = new Set(["inbox"]);
    const affairs: AffairReport[] = [];
    const skipped: { path: string; reason: string }[] = [];
    const planned = new Set<string>();
    for (const name of stat(sourceRoot) ? readdirSync(sourceRoot).sort() : []) {
      const source = join(sourceRoot, name);
      if ([".git", ".chrona"].includes(name) || !stat(source)?.isDirectory()) { skipped.push({ path: name, reason: "excluded metadata, symlink or non-directory" }); continue; }
      const readme = join(source, "README.md");
      const heading = stat(readme)?.isFile() ? /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/m.exec(readFileSync(readme, "utf8"))?.[1] : undefined;
      const title = heading?.trim() || name;
      const base = folderTitle(title);
      let folder = base, suffix = 2;
      while (used.has(folder.toLowerCase())) folder = `${base} (${suffix++})`;
      used.add(folder.toLowerCase());
      const affair: AffairReport = { directory: name, title, titleSource: heading ? "README.md first heading" : "directory name", target: `files/${folder}/`, filesToCopy: 0, files: [], skipped: [] };
      const connectors = mappings.get(name);
      function walk(relative: string) {
        for (const entry of readdirSync(join(source, relative)).sort()) {
          const path = relative ? `${relative}/${entry}` : entry;
          const info = stat(join(source, path))!;
          let reason = [".git", ".chrona"].includes(entry) ? "excluded metadata" : !safePart(entry) ? "unsafe path" : info.isSymbolicLink() ? "symlink" : !info.isFile() && !info.isDirectory() ? "special file" : executable.test(entry) ? "executable extension" : "";
          if (!reason && info.isDirectory()) { walk(path); continue; }
          if (!reason) {
            const fd = openSync(join(source, path), constants.O_RDONLY | constants.O_NOFOLLOW);
            const bytes = Buffer.alloc(2);
            try { readSync(fd, bytes); } finally { closeSync(fd); }
            if ((bytes[0] === 35 && bytes[1] === 33) || (bytes[0] === 77 && bytes[1] === 90) || (bytes[0] === 127 && bytes[1] === 69)) reason = "executable content";
          }
          if (reason) { affair.skipped.push({ path, reason }); continue; }
          let destination = `${folder}/${path}`;
          const parts = path.split("/");
          if (parts[0] === "inbox" && parts[1] && connectors?.has(parts[1])) destination = path;
          else if (parts[0] === "inbox" && connectors?.size === 1) destination = `inbox/${[...connectors][0]}/${parts.slice(1).join("/")}`;
          const target = join(root, destination);
          safeDirectory(dirname(target));
          const existing = stat(target);
          const action = planned.has(target) ? "conflict" : !existing ? "copy" : existing.isFile() && existing.nlink === 1 && digest(target) === digest(join(source, path)) ? "exists" : "conflict";
          planned.add(target);
          affair.files.push({ source: path, target: `files/${destination}`, action, copied: false });
          if (action === "copy") affair.filesToCopy++;
        }
      }
      walk(""); affairs.push(affair);
    }
    const reportPath = `${lock.databasePath}.migrate-affairs.json`;
    const reportInfo = stat(reportPath);
    if (options.apply && reportInfo && (!reportInfo.isFile() || reportInfo.nlink !== 1)) throw new Error("Unsafe migration report path.");
    let copied = 0;
    if (options.apply) {
      for (const affair of affairs) for (const file of affair.files) {
        if (file.action !== "copy") continue;
        const target = join(root, file.target.slice("files/".length));
        safeDirectory(dirname(target), true);
        copyFileSync(join(sourceRoot, affair.directory, file.source), target, constants.COPYFILE_EXCL);
        // Content is never executable, even if an old document had executable mode bits.
        chmodSync(target, 0o600);
        file.copied = true; copied++;
      }
    }
    const report = { mode: options.apply ? "apply" : "dry-run", backup, contentRoot: root, copied, affairs, skipped,
      notes: ["Titles use README.md first heading, falling back to directory name; no database titles used.", "Connector mappings use the backup database, if its legacy Affair/Connector tables exist; otherwise inbox stays within its affair folder.", "Originals preserved. Conflicting destinations are never overwritten. No database rows changed."] };
    if (options.apply) {
      writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    }
    return { report, reportPath: options.apply ? reportPath : null };
  } finally { lock.release(); }
}
