import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "bun:test";

import { acquireSqliteRuntimeLock, inspectSqliteRuntimeLock, quarantineStaleSqliteRuntimeLock, sqliteRuntimeLockPath } from "./sqlite-runtime-lock";

describe("SQLite runtime lock", () => {
  it("rejects a second live owner and releases ownership", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-lock-test-"));
    const databaseUrl = `file:${join(directory, "chrona.db")}`;
    try {
      const first = acquireSqliteRuntimeLock(databaseUrl);
      expect(existsSync(sqliteRuntimeLockPath(databaseUrl))).toBe(true);
      expect(() => acquireSqliteRuntimeLock(databaseUrl)).toThrow("already in use");
      first.release();
      expect(existsSync(sqliteRuntimeLockPath(databaseUrl))).toBe(false);
      acquireSqliteRuntimeLock(databaseUrl).release();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not steal a stale lock automatically", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-stale-lock-test-"));
    const databaseUrl = `file:${join(directory, "chrona.db")}`;
    const lockPath = sqliteRuntimeLockPath(databaseUrl);
    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(lockPath, JSON.stringify({ version: 1, pid: 999_999_999, createdAt: "2026-01-01T00:00:00.000Z" }));
      expect(() => acquireSqliteRuntimeLock(databaseUrl, { isProcessAlive: () => false }))
        .toThrow("stale database maintenance lock");
      expect(existsSync(lockPath)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("quarantines only a confirmed stale well-formed lock", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-repair-lock-test-"));
    const databaseUrl = `file:${join(directory, "chrona.db")}`;
    const lockPath = sqliteRuntimeLockPath(databaseUrl);
    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(lockPath, JSON.stringify({ version: 1, pid: 999_999_999, createdAt: "2026-01-01T00:00:00.000Z" }));
      expect(inspectSqliteRuntimeLock(databaseUrl, { isProcessAlive: () => false })).toMatchObject({ state: "stale" });
      const quarantined = quarantineStaleSqliteRuntimeLock(databaseUrl, { isProcessAlive: () => false });
      expect(quarantined).toContain(".stale-999999999-");
      expect(existsSync(lockPath)).toBe(false);
      expect(existsSync(quarantined!)).toBe(true);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("fails closed when lock ownership changes during repair", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-repair-lock-race-test-"));
    const databaseUrl = `file:${join(directory, "chrona.db")}`;
    const lockPath = sqliteRuntimeLockPath(databaseUrl);
    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(lockPath, JSON.stringify({ version: 1, pid: 999_999_999, createdAt: "2026-01-01T00:00:00.000Z" }));
      let probes = 0;
      expect(() => quarantineStaleSqliteRuntimeLock(databaseUrl, { isProcessAlive: () => ++probes > 1 })).toThrow("ownership changed");
      expect(existsSync(lockPath)).toBe(true);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("never repairs live or malformed locks", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-repair-lock-unsafe-test-"));
    const databaseUrl = `file:${join(directory, "chrona.db")}`;
    const lockPath = sqliteRuntimeLockPath(databaseUrl);
    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(lockPath, "not-json");
      expect(() => quarantineStaleSqliteRuntimeLock(databaseUrl)).toThrow("malformed");
      expect(existsSync(lockPath)).toBe(true);
      writeFileSync(lockPath, JSON.stringify({ version: 1, pid: process.pid, createdAt: "2026-01-01T00:00:00.000Z" }));
      expect(() => quarantineStaleSqliteRuntimeLock(databaseUrl, { isProcessAlive: () => true })).toThrow("running process");
      expect(existsSync(lockPath)).toBe(true);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("does not steal an incomplete lock while its owner may be publishing", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-incomplete-lock-test-"));
    const databaseUrl = `file:${join(directory, "chrona.db")}`;
    const lockPath = sqliteRuntimeLockPath(databaseUrl);
    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(lockPath, "");
      expect(() => acquireSqliteRuntimeLock(databaseUrl)).toThrow("incomplete database maintenance lock");
      expect(existsSync(lockPath)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
