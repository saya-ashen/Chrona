import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";

import { inspectLocalChrona, repairStaleRuntimeLock } from "./doctor";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("chrona doctor", () => {
  it("reports missing Git without attempting installation", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-doctor-no-git-"));
    try {
      process.env.DATABASE_URL = `file:${join(directory, "missing.db")}`;
      process.env.CHRONA_CONFIG_DIR = join(directory, "config");
      process.env.PATH = directory;
      process.env.HOST = "127.0.0.1";
      delete process.env.CHRONA_STEWARD_EXECUTION_MODE;
      delete process.env.CHRONA_STEWARD_SANDBOX_BWRAP;
      const checks = inspectLocalChrona();
      expect(checks).toContainEqual(expect.objectContaining({ key: "git", status: "error", message: expect.stringContaining("Install Git") }));
      // Optional interpreters, shell, Nix, browser and external tar are not global prerequisites.
      expect(checks.filter(check => check.status === "error").map(check => check.key)).toEqual(["git"]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it.each([
    { mode: undefined, bwrap: undefined, status: "ok", message: "host user permissions" },
    { mode: "", bwrap: "", status: "ok", message: "host user permissions" },
    { mode: " \t", bwrap: " \t", status: "ok", message: "host user permissions" },
    { mode: "trusted-local", bwrap: undefined, status: "ok", message: "host user permissions" },
    { mode: " trusted-local ", bwrap: undefined, status: "ok", message: "host user permissions" },
    { mode: "required-isolation", bwrap: undefined, status: "error", message: "Remove the setting" },
    { mode: "unknown", bwrap: undefined, status: "error", message: "supports only trusted-local" },
    { mode: "Trusted-local", bwrap: undefined, status: "error", message: "supports only trusted-local" },
    { mode: undefined, bwrap: "/missing/bwrap", status: "error", message: "CHRONA_STEWARD_SANDBOX_BWRAP has been removed" },
    { mode: "trusted-local", bwrap: "0", status: "error", message: "Remove this setting" },
    { mode: "required-isolation", bwrap: " /missing/bwrap ", status: "error", message: "CHRONA_STEWARD_SANDBOX_BWRAP has been removed" },
  ])("diagnoses execution mode $mode and legacy bwrap $bwrap", ({ mode, bwrap, status, message }) => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-doctor-mode-"));
    try {
      process.env.DATABASE_URL = `file:${join(directory, "missing.db")}`;
      process.env.CHRONA_CONFIG_DIR = join(directory, "config");
      if (mode === undefined) delete process.env.CHRONA_STEWARD_EXECUTION_MODE;
      else process.env.CHRONA_STEWARD_EXECUTION_MODE = mode;
      if (bwrap === undefined) delete process.env.CHRONA_STEWARD_SANDBOX_BWRAP;
      else process.env.CHRONA_STEWARD_SANDBOX_BWRAP = bwrap;
      expect(inspectLocalChrona()).toContainEqual(expect.objectContaining({ key: "executionMode", status, message: expect.stringContaining(message) }));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("exits nonzero with removal guidance for legacy isolation configuration", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-doctor-cli-"));
    try {
      const result = Bun.spawnSync([process.execPath, "run", join(import.meta.dir, "index.ts"), "doctor"], {
        env: { ...process.env, DATABASE_URL: `file:${join(directory, "missing.db")}`, CHRONA_CONFIG_DIR: join(directory, "config"), HOST: "127.0.0.1", CHRONA_STEWARD_EXECUTION_MODE: "required-isolation", CHRONA_STEWARD_SANDBOX_BWRAP: "" },
      });
      expect(result.exitCode).toBe(1);
      expect(result.stdout.toString()).toContain("[error] executionMode:");
      expect(result.stdout.toString()).toContain("Remove the setting or explicitly set trusted-local");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("reports a healthy localhost database", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-doctor-"));
    try {
      const databasePath = join(directory, "chrona.db");
      const db = new Database(databasePath);
      db.run('CREATE TABLE "Example" ("id" TEXT PRIMARY KEY)');
      db.close();
      process.env.DATABASE_URL = `file:${databasePath}`;
      process.env.HOST = "127.0.0.1";
      delete process.env.API_KEY;

      const checks = inspectLocalChrona();
      expect(checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: "git", status: "ok" }),
        expect.objectContaining({ key: "database", status: "ok" }),
        expect.objectContaining({ key: "databaseIntegrity", status: "ok" }),
        expect.objectContaining({ key: "networkBind", status: "ok" }),
        expect.objectContaining({ key: "apiProtection", status: "warning" }),
      ]));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not treat LAN, IPv6 wildcard, or a non-loopback hostname as local-only", () => {
    for (const host of ["192.168.1.30", "::", "chrona.example.test"]) {
      process.env.DATABASE_URL = `file:${join(tmpdir(), `chrona-doctor-${host.replaceAll(/[^a-z0-9]/gi, "-")}.db`)}`;
      process.env.HOST = host;
      delete process.env.API_KEY;
      expect(inspectLocalChrona()).toContainEqual(expect.objectContaining({ key: "apiProtection", status: "error" }));
    }
  });

  it("reports unsafe POSIX modes and repairs only a stale lock", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-doctor-permissions-"));
    const databasePath = join(directory, "chrona.db");
    try {
      writeFileSync(databasePath, "not-a-database", { mode: 0o644 });
      if (process.platform !== "win32") chmodSync(databasePath, 0o644);
      const configDirectory = join(directory, "config");
      writeFileSync(`${databasePath}-wal`, "sensitive", { mode: 0o644 });
      writeFileSync(join(directory, "backups"), "not-a-directory", { mode: 0o600 });
      if (process.platform !== "win32") chmodSync(`${databasePath}-wal`, 0o644);
      process.env.DATABASE_URL = `file:${databasePath}`;
      process.env.CHRONA_CONFIG_DIR = configDirectory;
      process.env.HOST = "127.0.0.1";
      const checks = inspectLocalChrona();
      if (process.platform !== "win32") {
        expect(checks).toContainEqual(expect.objectContaining({ key: "databasePermissions", status: "warning" }));
        expect(checks).toContainEqual(expect.objectContaining({ key: "databaseArtifactsPermissions", status: "warning" }));
        expect(checks).toContainEqual(expect.objectContaining({ key: "configDirectoryPermissions", status: "warning" }));
      }
      const lockPath = `${databasePath}.chrona.lock`;
      writeFileSync(lockPath, JSON.stringify({ version: 1, pid: 999_999_999, createdAt: "2026-01-01T00:00:00.000Z" }));
      const quarantined = repairStaleRuntimeLock();
      expect(quarantined).toContain(".stale-");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("flags an unprotected public bind", () => {
    process.env.DATABASE_URL = `file:${join(tmpdir(), "chrona-doctor-missing.db")}`;
    process.env.HOST = "0.0.0.0";
    delete process.env.API_KEY;

    expect(inspectLocalChrona()).toContainEqual(
      expect.objectContaining({ key: "apiProtection", status: "error" }),
    );
  });
});
