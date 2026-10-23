import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireSqliteRuntimeLock } from "@chrona/db/sqlite-runtime-lock";
import { migrateAffairs } from "./migrate-affairs";

function fixture() {
  const temp = mkdtempSync(join(tmpdir(), "chrona-migrate-affairs-"));
  const data = join(temp, "data");
  const source = join(data, "affairs", "old");
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "README.md"), "# Travel / plans\n\nNotes");
  writeFileSync(join(source, "notes.md"), "document");
  chmodSync(join(source, "notes.md"), 0o755);
  const database = join(temp, "chrona.db");
  const url = `file:${database}`;
  const db = new Database(database);
  db.run("CREATE TABLE Module (id TEXT, name TEXT, builtin BOOLEAN)");
  db.run("INSERT INTO Module VALUES ('files-id', 'files', 1)");
  db.run("CREATE TABLE Affair (id TEXT, dirName TEXT)");
  db.run("CREATE TABLE Connector (id TEXT, affairId TEXT)");
  db.run("INSERT INTO Affair VALUES ('a', 'old')");
  db.run("INSERT INTO Connector VALUES ('mail', 'a')");
  db.close();
  const backup = join(temp, "backup.db");
  const run = (...args: string[]) => Bun.spawnSync([process.execPath, "run", "packages/cli/src/index.ts", ...args], {
    env: { ...process.env, CHRONA_DATA_DIR: data, DATABASE_URL: url },
  });
  const makeBackup = () => {
    const result = run("backup", backup);
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  };
  return { temp, data, source, database, url, backup, run, makeBackup,
    clean: () => rmSync(temp, { recursive: true, force: true }) };
}

test("CLI dry-run reports titles, deduplication, fallback and connector destinations without writing content", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.data, "affairs", "fallback"));
    writeFileSync(join(f.data, "affairs", "fallback", "note.txt"), "fallback");
    mkdirSync(join(f.data, "affairs", "duplicate"));
    writeFileSync(join(f.data, "affairs", "duplicate", "README.md"), "# Travel / plans");
    mkdirSync(join(f.source, "inbox", "mail"), { recursive: true });
    writeFileSync(join(f.source, "inbox", "mail", "letter.md"), "mail");
    mkdirSync(join(f.data, "affairs", "fallback", "inbox"));
    writeFileSync(join(f.data, "affairs", "fallback", "inbox", "unknown.md"), "unmapped");
    f.makeBackup();
    const db = new Database(f.database); db.run("DROP TABLE Affair"); db.run("DROP TABLE Connector"); db.close();
    const result = f.run("migrate-affairs", "--backup", f.backup);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.toString());
    expect(report.mode).toBe("dry-run");
    expect(report.copied).toBe(0);
    expect(report.affairs.map((a: { target: string }) => a.target)).toEqual(["files/Travel _ plans/", "files/fallback/", "files/Travel _ plans (2)/"]);
    expect(report.affairs[1].titleSource).toBe("directory name");
    expect(report.affairs[2].titleSource).toBe("README.md first heading");
    expect(report.affairs[2].filesToCopy).toBe(3);
    expect(report.affairs[2].files.some((file: { target: string }) => file.target === "files/inbox/mail/letter.md")).toBe(true);
    expect(report.affairs[1].files.some((file: { target: string }) => file.target === "files/fallback/inbox/unknown.md")).toBe(true);
    expect(existsSync(join(f.data, "platform"))).toBe(false);
    expect(existsSync(`${f.database}.migrate-affairs.json`)).toBe(false);
    expect(existsSync(`${f.backup}.affairs.tar`)).toBe(true);
  } finally { f.clean(); }
});

test("apply copies only content, preserves originals and database, and is idempotent", () => {
  const f = fixture();
  try {
    for (const directory of [".git", ".chrona"]) {
      mkdirSync(join(f.source, directory)); writeFileSync(join(f.source, directory, "private"), "synthetic metadata");
    }
    for (const file of ["script.ts", "run.SH", "payload.wasm"]) writeFileSync(join(f.source, file), "executable");
    writeFileSync(join(f.source, "disguised.txt"), "#!/bin/sh\nexit 0");
    symlinkSync(join(f.source, "notes.md"), join(f.source, "link.md"));
    f.makeBackup();
    const before = readFileSync(f.database);
    const first = migrateAffairs(f.url, f.data, { backup: f.backup, apply: true });
    expect(first.report.copied).toBe(2);
    const output = join(f.data, "platform", "content", "files-id", "Travel _ plans");
    expect(readdirSync(output).sort()).toEqual(["README.md", "notes.md"]);
    expect(lstatSync(join(output, "notes.md")).mode & 0o111).toBe(0);
    expect(readFileSync(join(output, "notes.md"), "utf8")).toBe("document");
    expect(existsSync(join(f.source, ".git", "private"))).toBe(true);
    expect(first.report.affairs[0]!.skipped).toHaveLength(7);
    expect(JSON.parse(readFileSync(first.reportPath!, "utf8")).copied).toBe(2);
    const second = migrateAffairs(f.url, f.data, { backup: f.backup, apply: true });
    expect(second.report.copied).toBe(0);
    expect(second.report.affairs[0]!.filesToCopy).toBe(0);
    expect(readFileSync(f.database)).toEqual(before);
    writeFileSync(join(output, "notes.md"), "user edit");
    const third = migrateAffairs(f.url, f.data, { backup: f.backup, apply: true });
    expect(third.report.affairs[0]!.files.find(file => file.source === "notes.md")!.action).toBe("conflict");
    expect(readFileSync(join(output, "notes.md"), "utf8")).toBe("user edit");
  } finally { f.clean(); }
});

test("refuses absent, non-Chrona, stale or tampered backups", () => {
  const f = fixture();
  try {
    expect(f.run("migrate-affairs").exitCode).not.toBe(0);
    expect(() => migrateAffairs(f.url, f.data, {})).toThrow("fresh --backup");
    expect(() => migrateAffairs(f.url, f.data, { backup: f.database })).toThrow("fresh --backup");
    f.makeBackup();
    writeFileSync(join(f.source, "notes.md"), "new data");
    expect(() => migrateAffairs(f.url, f.data, { backup: f.backup, apply: true })).toThrow("fresh --backup");
    expect(existsSync(join(f.data, "platform"))).toBe(false);
  } finally { f.clean(); }
  const other = fixture();
  try {
    other.makeBackup(); writeFileSync(`${other.backup}.affairs.tar`, "invalid");
    expect(() => migrateAffairs(other.url, other.data, { backup: other.backup })).toThrow("fresh --backup");
  } finally { other.clean(); }
});

test("refuses missing files module, a running server, and unsafe destination ancestors", () => {
  const f = fixture();
  try {
    f.makeBackup();
    const lock = acquireSqliteRuntimeLock(f.url);
    try { expect(() => migrateAffairs(f.url, f.data, { backup: f.backup })).toThrow(); }
    finally { lock.release(); }
    const db = new Database(f.database); db.run("DELETE FROM Module"); db.close();
    expect(() => migrateAffairs(f.url, f.data, { backup: f.backup })).toThrow("built-in files module");
    const db2 = new Database(f.database); db2.run("INSERT INTO Module VALUES ('files-id', 'files', 1)"); db2.close();
    mkdirSync(join(f.temp, "elsewhere")); symlinkSync(join(f.temp, "elsewhere"), join(f.data, "platform"));
    expect(() => migrateAffairs(f.url, f.data, { backup: f.backup, apply: true })).toThrow("Unsafe directory");
    expect(readdirSync(join(f.temp, "elsewhere"))).toEqual([]);
  } finally { f.clean(); }
});
