import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { backupSqliteDatabase, restoreSqliteDatabase } from "./sqlite-backup";
import { acquireSqliteRuntimeLock } from "./sqlite-runtime-lock";

function createDatabase(path: string, value: string): void {
  const db = new Database(path);
  try {
    db.run('CREATE TABLE "Example" ("value" TEXT NOT NULL)');
    db.run('INSERT INTO "Example" ("value") VALUES (?)', [value]);
  } finally {
    db.close();
  }
}

function readValue(path: string): string {
  const db = new Database(path, { readonly: true });
  try {
    return (db.query('SELECT "value" FROM "Example"').get() as { value: string }).value;
  } finally {
    db.close();
  }
}

describe("SQLite backup and restore", () => {
  it("round trips affairs including git history and private connector secrets, replacing stale files", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-files-backup-"));
    try {
      const data = join(directory, "data");
      mkdirSync(join(data, "affairs", "a", ".git"), { recursive: true });
      mkdirSync(join(data, "secrets"));
      writeFileSync(join(data, "affairs", "a", "README.md"), "- [x] done");
      writeFileSync(join(data, "affairs", "a", ".git", "HEAD"), "ref: refs/heads/main\n");
      writeFileSync(join(data, "secrets", "email.json"), "test-secret");
      writeFileSync(join(data, "affairs", "a", "check.sh"), "#!/bin/sh\n", { mode: 0o700 });
      const db = join(directory, "outside-data.db");
      const backup = join(directory, "backup.db");
      createDatabase(db, "saved");
      backupSqliteDatabase(`file:${db}`, backup, data);
      expect(statSync(`${backup}.tar`).mode & 0o777).toBe(0o600);
      writeFileSync(join(data, "affairs", "stale.md"), "stale");
      writeFileSync(join(data, "secrets", "email.json"), "changed");
      expect(() => restoreSqliteDatabase(`file:${db}`, backup, { dataDir: data })).toThrow("Pass --force");
      restoreSqliteDatabase(`file:${db}`, backup, { force: true, dataDir: data });
      expect(readValue(db)).toBe("saved");
      expect(readFileSync(join(data, "affairs", "a", "README.md"), "utf8")).toBe("- [x] done");
      expect(readFileSync(join(data, "affairs", "a", ".git", "HEAD"), "utf8")).toContain("refs/heads/main");
      expect(readFileSync(join(data, "secrets", "email.json"), "utf8")).toBe("test-secret");
      expect(statSync(join(data, "secrets", "email.json")).mode & 0o777).toBe(0o600);
      expect(existsSync(join(data, "affairs", "stale.md"))).toBe(false);
      expect(statSync(join(data, "affairs", "a", "check.sh")).mode & 0o777).toBe(0o700);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("supports absent data roots and rejects missing/corrupt archives before changing the database", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-empty-backup-"));
    try {
      const db = join(directory, "active.db");
      const backup = join(directory, "backup.db");
      const data = join(directory, "restored");
      createDatabase(db, "current");
      backupSqliteDatabase(`file:${db}`, backup, directory);
      restoreSqliteDatabase(`file:${db}`, backup, { force: true, dataDir: data });
      expect(existsSync(join(data, "affairs"))).toBe(true);
      renameSync(`${backup}.tar`, `${backup}.saved.tar`);
      expect(() => restoreSqliteDatabase(`file:${db}`, backup, { force: true, dataDir: data })).toThrow();
      writeFileSync(`${backup}.tar`, "corrupt");
      expect(() => restoreSqliteDatabase(`file:${db}`, backup, { force: true, dataDir: data })).toThrow("Truncated");
      expect(readValue(db)).toBe("current");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("refuses live full backups and symlinks; rolls directories back on database replacement failure", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-files-safety-"));
    try {
      const db = join(directory, "active.db");
      const backup = join(directory, "backup.db");
      createDatabase(db, "current");
      mkdirSync(join(directory, "affairs"));
      writeFileSync(join(directory, "affairs", "README.md"), "saved");
      const lock = acquireSqliteRuntimeLock(`file:${db}`);
      try { expect(() => backupSqliteDatabase(`file:${db}`, backup, directory)).toThrow("already in use"); }
      finally { lock.release(); }
      backupSqliteDatabase(`file:${db}`, backup, directory);
      writeFileSync(join(directory, "affairs", "README.md"), "current");
      expect(() => restoreSqliteDatabase(`file:${db}`, backup, {
        force: true, dataDir: directory,
        rename() { throw new Error("injected failure"); },
      })).toThrow("injected failure");
      expect(readFileSync(join(directory, "affairs", "README.md"), "utf8")).toBe("current");
      symlinkSync(db, join(directory, "affairs", "link"));
      expect(() => backupSqliteDatabase(`file:${db}`, join(directory, "unsafe.db"), directory)).toThrow("symlinks");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it("rejects traversal and link archive entries without replacing data", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-archive-validation-"));
    try {
      const db = join(directory, "active.db"), backup = join(directory, "backup.db");
      createDatabase(db, "current");
      mkdirSync(join(directory, "affairs"));
      backupSqliteDatabase(`file:${db}`, backup, directory);
      const original = readFileSync(`${backup}.tar`);
      for (const [name, type] of [["affairs/../../escaped", "5"], ["/affairs", "5"], ["affairs/link", "2"]]) {
        const malicious = Buffer.from(original);
        malicious.fill(0, 0, 100);
        malicious.write(name!, 0);
        malicious.write(type!, 156);
        malicious.fill(32, 148, 156);
        const checksum = malicious.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
        malicious.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
        writeFileSync(`${backup}.tar`, malicious);
        expect(() => restoreSqliteDatabase(`file:${db}`, backup, { force: true, dataDir: directory })).toThrow("unsafe");
        expect(readValue(db)).toBe("current");
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("creates a consistent backup while WAL mode has uncheckpointed data", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-backup-"));
    let live: Database | undefined;
    try {
      const databasePath = join(directory, "chrona.db");
      const backupPath = join(directory, "backups", "chrona.db");
      live = new Database(databasePath);
      live.run("PRAGMA journal_mode = WAL");
      live.run('CREATE TABLE "Example" ("value" TEXT NOT NULL)');
      live.run('INSERT INTO "Example" ("value") VALUES (?)', ["preserved"]);
      expect(existsSync(`${databasePath}-wal`)).toBe(true);

      const result = backupSqliteDatabase(`file:${databasePath}`, backupPath);

      expect(result.backupPath).toBe(backupPath);
      expect(readValue(backupPath)).toBe("preserved");
    } finally {
      live?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not chmod an existing user-selected backup parent", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-backup-parent-"));
    try {
      const databasePath = join(directory, "chrona.db");
      const backupDirectory = join(directory, "selected-backups");
      createDatabase(databasePath, "current");
      mkdirSync(backupDirectory, { mode: 0o700 });
      if (process.platform !== "win32") chmodSync(backupDirectory, 0o755);

      backupSqliteDatabase(`file:${databasePath}`, join(backupDirectory, "chrona.db"));

      if (process.platform !== "win32") expect(statSync(backupDirectory).mode & 0o777).toBe(0o755);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses overwrite by default and restores only with force", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-restore-"));
    try {
      const databasePath = join(directory, "chrona.db");
      const backupPath = join(directory, "backup.db");
      createDatabase(databasePath, "current");
      createDatabase(backupPath, "restored");

      expect(() => restoreSqliteDatabase(`file:${databasePath}`, backupPath)).toThrow("Pass --force");
      restoreSqliteDatabase(`file:${databasePath}`, backupPath, { force: true });

      expect(readValue(databasePath)).toBe("restored");
      expect(existsSync(`${databasePath}-wal`)).toBe(false);
      expect(existsSync(`${databasePath}-shm`)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retains a verified pre-restore recovery copy", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-restore-recovery-"));
    try {
      const databasePath = join(directory, "chrona.db");
      const backupPath = join(directory, "backup.db");
      createDatabase(databasePath, "current");
      createDatabase(backupPath, "restored");

      const result = restoreSqliteDatabase(`file:${databasePath}`, backupPath, { force: true });
      expect(readValue(databasePath)).toBe("restored");
      expect(result.recoveryPath).not.toBeNull();
      expect(readValue(result.recoveryPath!)).toBe("current");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses restore while a server owns the database lock", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-restore-lock-"));
    try {
      const databasePath = join(directory, "chrona.db");
      const backupPath = join(directory, "backup.db");
      createDatabase(databasePath, "current");
      createDatabase(backupPath, "restored");
      const lock = acquireSqliteRuntimeLock(`file:${databasePath}`);
      try {
        expect(() => restoreSqliteDatabase(`file:${databasePath}`, backupPath, { force: true }))
          .toThrow("already in use");
      } finally {
        lock.release();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("recovers the verified WAL-aware snapshot and rechecks force after replacement interruption", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-restore-rollback-"));
    let live: Database | undefined;
    try {
      const databasePath = join(directory, "chrona.db");
      const backupPath = join(directory, "backup.db");
      createDatabase(databasePath, "before-wal");
      createDatabase(backupPath, "restored");
      live = new Database(databasePath);
      live.run("PRAGMA journal_mode = WAL");
      live.run('UPDATE "Example" SET "value" = ?', ["current-wal"]);
      expect(existsSync(`${databasePath}-wal`)).toBe(true);

      expect(() => restoreSqliteDatabase(`file:${databasePath}`, backupPath, {
        force: true,
        rename(from, to) {
          if (from.includes(".restore-stage-") || (from.includes(".pre-restore-") && to === databasePath)) {
            throw new Error("injected replacement failure");
          }
          renameSync(from, to);
        },
      })).toThrow("injected replacement failure");
      expect(existsSync(databasePath)).toBe(false);
      expect(existsSync(`${databasePath}.restore.json`)).toBe(true);

      // Recovery recreates the active DB, so a non-forced restore must refuse it.
      expect(() => restoreSqliteDatabase(`file:${databasePath}`, backupPath)).toThrow("Pass --force");
      expect(existsSync(`${databasePath}.restore.json`)).toBe(false);
      expect(readValue(databasePath)).toBe("current-wal");
    } finally {
      live?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("recovers committed WAL data when interrupted after sidecar removal", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-restore-sidecar-interruption-"));
    let live: Database | undefined;
    try {
      const databasePath = join(directory, "chrona.db");
      const backupPath = join(directory, "backup.db");
      createDatabase(databasePath, "before-wal");
      createDatabase(backupPath, "restored");
      live = new Database(databasePath);
      live.run("PRAGMA journal_mode = WAL");
      live.run('UPDATE "Example" SET "value" = ?', ["committed-in-wal"]);
      expect(existsSync(`${databasePath}-wal`)).toBe(true);

      expect(() => restoreSqliteDatabase(`file:${databasePath}`, backupPath, {
        force: true,
        onSidecarsRemoved() {
          throw new Error("injected sidecar interruption");
        },
      })).toThrow("injected sidecar interruption");
      expect(existsSync(`${databasePath}-wal`)).toBe(false);
      expect(existsSync(`${databasePath}.restore.json`)).toBe(true);

      // Recovery must reject the now-stale main file and use the verified
      // WAL-aware snapshot before applying the normal overwrite guard.
      expect(() => restoreSqliteDatabase(`file:${databasePath}`, backupPath)).toThrow("Pass --force");
      expect(readValue(databasePath)).toBe("committed-in-wal");
      expect(existsSync(`${databasePath}.restore.json`)).toBe(false);
    } finally {
      live?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a corrupt backup before replacing user data", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-corrupt-restore-"));
    try {
      const databasePath = join(directory, "chrona.db");
      const backupPath = join(directory, "backup.db");
      createDatabase(databasePath, "current");
      Bun.write(backupPath, "not sqlite");

      expect(() => restoreSqliteDatabase(`file:${databasePath}`, backupPath, { force: true })).toThrow();
      expect(readValue(databasePath)).toBe("current");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
