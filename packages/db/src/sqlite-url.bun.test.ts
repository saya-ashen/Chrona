import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

import {
  assertSafeTestDatabaseUrl,
  ensureSqliteParentDir,
  isInMemorySqliteUrl,
  isSafeTestDatabaseUrl,
  resolveRuntimeDatabaseUrl,
  resolveSqliteAdapterUrl,
  sqlitePathFromFileUrl,
} from "./sqlite-url";
import {
  assertWindowsPrivateStorage,
  buildWindowsAclAuditCommand,
  buildWindowsOwnerAclCommand,
  buildWindowsPrivateAclCommand,
  buildWindowsRemoveAclCommand,
  ensureWindowsPrivateDirectory,
  parseWindowsAclAudit,
  windowsAclIsPrivate,
} from "./windows-private-storage";

const posixIt = process.platform === "win32" ? it.skip : it;
const windowsIt = process.platform === "win32" ? it : it.skip;

describe("sqlite url helpers", () => {
  it("uses explicit DATABASE_URL first", () => {
    expect(resolveRuntimeDatabaseUrl({ DATABASE_URL: "file:/data/chrona.db", NODE_ENV: "production" })).toBe(
      "file:/data/chrona.db",
    );
  });

  it("keeps development default local", () => {
    expect(resolveRuntimeDatabaseUrl({ NODE_ENV: "development" })).toBe("file:./prisma/dev.db");
  });

  it("defaults tests to an isolated local database", () => {
    const env = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
    expect(resolveRuntimeDatabaseUrl(env)).toBe("file:./.tmp/bun-test.db");
    expect(env.DATABASE_URL).toBe("file:./.tmp/bun-test.db");
    expect(env.CHRONA_AUTO_TEST_DATABASE_URL).toBe("1");
  });

  it("rejects unsafe test database urls", () => {
    expect(() => resolveRuntimeDatabaseUrl({ NODE_ENV: "test", DATABASE_URL: "file:./prisma/dev.db" })).toThrow(
      "does not point to an isolated test SQLite database",
    );
    expect(() => assertSafeTestDatabaseUrl("file:/data/chrona.db")).toThrow(
      "does not point to an isolated test SQLite database",
    );
  });

  it("detects safe test database urls", () => {
    expect(isSafeTestDatabaseUrl(undefined)).toBe(false);
    expect(isSafeTestDatabaseUrl("file:./prisma/dev.db")).toBe(false);
    expect(isSafeTestDatabaseUrl("file:./.tmp/bun-test.db")).toBe(true);
    expect(isSafeTestDatabaseUrl("file:/tmp/chrona-test.db")).toBe(true);
    expect(isSafeTestDatabaseUrl("file::memory:")).toBe(true);
  });

  it("parses sqlite file urls", () => {
    expect(sqlitePathFromFileUrl("file:./.tmp/bun-test.db?connection_limit=1")).toBe("./.tmp/bun-test.db");
    expect(sqlitePathFromFileUrl("file:/data/chrona.db")).toBe("/data/chrona.db");
    expect(sqlitePathFromFileUrl("postgres://localhost/db")).toBeNull();
  });

  it("normalizes file URL query parameters for the SQLite adapter", () => {
    expect(resolveSqliteAdapterUrl("file:/data/chrona.db?connection_limit=1")).toBe("file:/data/chrona.db");
    expect(resolveSqliteAdapterUrl("file::memory:")).toBe("file::memory:");
  });

  posixIt("does not chmod an existing selected SQLite parent", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-sqlite-parent-"));
    const selectedParent = join(directory, "existing");
    try {
      mkdirSync(selectedParent, { mode: 0o700 });
      if (process.platform !== "win32") chmodSync(selectedParent, 0o755);

      ensureSqliteParentDir(`file:${join(selectedParent, "chrona.db")}`);

      if (process.platform !== "win32") expect(statSync(selectedParent).mode & 0o777).toBe(0o755);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("builds and validates locale-independent Windows owner-only ACL commands", () => {
    const path = "C:\\Chrona data\\user-selected";
    expect(buildWindowsOwnerAclCommand("C:\\Chrona\\data", "S-1-5-21-100")).toEqual({
      command: "icacls.exe",
      args: ["C:\\Chrona\\data", "/setowner", "*S-1-5-21-100"],
    });
    expect(buildWindowsRemoveAclCommand("C:\\Chrona\\data", "S-1-5-32-544")).toEqual({
      command: "icacls.exe",
      args: ["C:\\Chrona\\data", "/remove", "*S-1-5-32-544"],
    });
    expect(buildWindowsPrivateAclCommand("C:\\Chrona\\data", "S-1-5-21-100", true)).toEqual({
      command: "icacls.exe",
      args: ["C:\\Chrona\\data", "/inheritance:r", "/grant:r", "*S-1-5-21-100:(OI)(CI)(F)", "*S-1-5-18:(OI)(CI)(F)"],
    });
    const auditCommand = buildWindowsAclAuditCommand(path);
    expect(auditCommand.command).toBe("powershell.exe");
    expect(auditCommand.args).not.toContain(path);
    expect(auditCommand.args.at(-2)).toBe("-Command");
    expect(auditCommand.args.at(-1)).toContain("[System.IO.Directory]::GetAccessControl");
    expect(auditCommand.args.at(-1)).toContain("$result | ConvertTo-Json");
    expect(auditCommand.args.at(-1)).not.toContain("Get-Acl");
    expect(auditCommand.args.at(-1)).not.toContain("[Console]::Out.Write");
    expect(Object.values(auditCommand.env ?? {})).toEqual([path]);
    const audit = parseWindowsAclAudit('{"owner":"S-1-5-21-100","currentUser":"S-1-5-21-100","rules":[{"sid":"S-1-5-21-100","accessType":"Allow","rights":2032127,"inherited":false},{"sid":"S-1-5-18","accessType":"Allow","rights":2032127,"inherited":false}]}');
    expect(windowsAclIsPrivate(audit)).toBe(true);
    expect(windowsAclIsPrivate({ ...audit, rules: audit.rules.map((rule) => ({ ...rule, inherited: true })) })).toBe(true);
    expect(windowsAclIsPrivate({ ...audit, rules: audit.rules.map((rule) => rule.sid === "S-1-5-18" ? { ...rule, rights: 1 } : rule) })).toBe(false);
    expect(windowsAclIsPrivate({ ...audit, rules: audit.rules.map((rule) => rule.sid === "S-1-5-21-100" ? { ...rule, rights: 1 } : rule) })).toBe(false);
    expect(windowsAclIsPrivate({ ...audit, rules: [...audit.rules, { sid: "S-1-1-0", accessType: "Allow", rights: 1, inherited: false }] })).toBe(false);
  });

  windowsIt("creates and audits a generated private Windows directory", () => {
    const root = mkdtempSync(join(tmpdir(), "chrona-windows-acl-test-"));
    const target = join(root, "private path");
    try {
      ensureWindowsPrivateDirectory(target);
      expect(() => assertWindowsPrivateStorage(target)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("detects in-memory urls", () => {
    expect(isInMemorySqliteUrl("file::memory:")).toBe(true);
    expect(isInMemorySqliteUrl(":memory:")).toBe(true);
  });
});
