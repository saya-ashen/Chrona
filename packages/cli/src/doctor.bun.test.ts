import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, mkdtempSync, rmSync, statSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";

import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { inspectExternalApps, inspectLocalChrona, repairStaleRuntimeLock } from "./doctor";

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
      process.env.CHRONA_STEWARD_AGENT = "other";
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
      expect(result.stdout.toString()).toContain("[ok] externalApps:");
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

function migrationFixture() {
  const directory = mkdtempSync(join(tmpdir(), "chrona-doctor-migration-"));
  const migrationsDir = join(directory, "migrations");
  mkdirSync(join(migrationsDir, "0001_initial"), { recursive: true });
  writeFileSync(join(migrationsDir, "0001_initial", "migration.sql"), 'CREATE TABLE "Example" ("id" TEXT PRIMARY KEY);');
  const path = join(directory, "chrona.db"), databaseUrl = `file:${path}`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.CHRONA_CONFIG_DIR = join(directory, "config");
  process.env.CHRONA_MIGRATIONS_DIR = migrationsDir;
  return { directory, path, databaseUrl, migrationsDir };
}

it.each(["valid", "checksum", "name", "untracked", "prefix", "empty", "missing"])("checks migration history: %s without writing the database", scenario => {
  const f = migrationFixture();
  try {
    if (!["missing", "empty", "untracked"].includes(scenario)) ensureSqliteDatabase(f);
    if (scenario !== "missing") {
      const db = new Database(f.path);
      if (scenario === "checksum") db.exec("UPDATE _chrona_migrations SET checksum='x'");
      if (scenario === "name") db.exec("UPDATE _chrona_migrations SET name='other'");
      if (scenario === "untracked") db.exec("CREATE TABLE Example (id TEXT)");
      db.close();
    }
    if (scenario === "prefix") {
      mkdirSync(join(f.migrationsDir, "0002_next"));
      writeFileSync(join(f.migrationsDir, "0002_next", "migration.sql"), "CREATE TABLE Next (id TEXT);");
    }
    const before = scenario === "missing" ? null : statSync(f.path, { bigint: true });
    const result = inspectLocalChrona().find(check => check.key === "migrationHistory");
    expect(result?.status).toBe(["checksum", "name", "untracked"].includes(scenario) ? "error" : "ok");
    if (["checksum", "name"].includes(scenario)) expect(result?.message).toContain("different schema baseline");
    if (scenario === "untracked") expect(result?.message).toContain("untracked database");
    if (scenario === "valid") expect(result?.message).toContain("0 pending migrations");
    if (["prefix", "empty"].includes(scenario)) expect(result?.message).toContain("1 pending migrations");
    if (before) expect(statSync(f.path, { bigint: true }).mtimeNs).toBe(before.mtimeNs);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

it.each([
  { agent: "pi", version: "0.85.0", command: "/opt/pi", status: "warning" },
  { agent: undefined, version: "1.5.0", command: "/opt/pi", status: "ok" },
  { agent: "pi", version: "1.5.0", command: "pi", status: "error" },
  { agent: "pi", version: "1.5.0", command: undefined, status: "error" },
  { agent: "pi", version: undefined, command: "/opt/pi", status: "warning" },
])("checks Pi configuration: $version $command", ({ agent, version, command, status }) => {
  const f = migrationFixture();
  try {
    for (const [key, value] of [["CHRONA_STEWARD_AGENT", agent], ["CHRONA_STEWARD_PI_VERSION", version], ["CHRONA_STEWARD_PI_COMMAND", command]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
    const checks = inspectLocalChrona().filter(check => check.key === "providerPi");
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe(status);
    if (status === "warning") expect(checks[0]?.message).toContain("Pi completion requires CHRONA_STEWARD_PI_VERSION=1.5.0");
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

it.each(["fresh", "local", "outdated", "unfetched", "missing", "invalid"])("compares the bundled release with installed Git ancestry: %s without writing data", async scenario => {
  const directory = mkdtempSync(join(tmpdir(), "chrona-doctor-install-"));
  const databasePath = join(directory, "chrona-test.db");
  ensureSqliteDatabase({ databaseUrl: `file:${databasePath}`, migrationsDir: join(import.meta.dir, "../../../prisma/migrations") });
  const { PrismaClient } = await import("@chrona/db/generated/prisma/client");
  const { PrismaBunSqlite } = await import("prisma-adapter-bun-sqlite");
  const { seedTestModuleRelease } = await import("../../engine/src/modules/steward/module-release-test-fixture");
  const { testModuleSandbox } = await import("../../engine/src/modules/steward/module-test-process");
  const { createExternalModuleInstaller, installExternal, externalPackageCatalog, refreshInstallationReceipts } = await import("../../engine/src/modules/steward/module-install");
  const { buildPending } = await import("../../engine/src/modules/steward/module-build");
  const { moduleContext } = await import("../../engine/src/modules/steward/module-context");
  const db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: `file:${databasePath}` }) });
  try {
    const workspaceId = "ws_default";
    await db.workspace.create({ data: { id: workspaceId, name: "Doctor" } });
    const resources = join(directory, "external"), code = join(resources, "web");
    mkdirSync(code, { recursive: true });
    writeFileSync(join(code, "module.json"), JSON.stringify({ name: "web", entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [] }));
    writeFileSync(join(code, "index.ts"), "// synthetic fixture\n");
    writeFileSync(join(code, "test.ts"), "// offline fixture\n");
    await seedTestModuleRelease(resources, "web");
    const ports: import("../../engine/src/modules/steward/ports").StewardPorts = { db, dataDir: directory, now: () => new Date(), publicUrl: null, moduleExternalResources: resources, sandbox: testModuleSandbox(async () => ({ status: "succeeded", exitCode: 0, output: "{}", error: null })) };
    ports.moduleExternalInstaller = createExternalModuleInstaller(ports);
    const request = { package: "web" as const, mode: "install" as const, requestKey: "doctor-install" };
    const first = await installExternal(ports, workspaceId, request);
    expect(first.status).toBe("building");
    await buildPending(moduleContext(ports, workspaceId));
    await refreshInstallationReceipts(ports, workspaceId);
    const installed = await installExternal(ports, workspaceId, request);
    expect(installed.status).toBe("installed");
    const entry = (await externalPackageCatalog(ports, workspaceId)).find(item => item.name === "web")!;
    const module = await db.module.findUniqueOrThrow({ where: { id: installed.moduleId! } });
    expect(entry.releaseHash).toBe(entry.git?.commit ?? null);
    expect(entry.releaseHash).toBe(module.activeHash);
    expect(entry.installation?.hash).toBe(entry.releaseHash);
    process.env.DATABASE_URL = `file:${databasePath}`;
    process.env.CHRONA_DATA_DIR = directory;
    process.env.CHRONA_RESOURCE_DIR = directory;
    const repo = join(directory, "platform", "repos", `${module.id}.git`);
    const git = (...args: string[]) => execFileSync("git", [`--git-dir=${repo}`, ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_AUTHOR_NAME: "Doctor test", GIT_AUTHOR_EMAIL: "doctor@localhost", GIT_COMMITTER_NAME: "Doctor test", GIT_COMMITTER_EMAIL: "doctor@localhost" },
    }).trim();
    if (scenario !== "fresh") {
      const tree = git("rev-parse", `${entry.releaseHash}^{tree}`);
      const activeHash = scenario === "invalid" ? "a".repeat(40)
        : git("commit-tree", tree, ...(scenario === "outdated" ? [] : ["-p", entry.releaseHash!]), "-m", "Local customization");
      await db.module.update({ where: { id: module.id }, data: { activeHash } });
      if (scenario === "missing") rmSync(repo, { recursive: true });
    }
    if (scenario === "unfetched") {
      writeFileSync(join(code, "index.ts"), "// new bundled release, never fetched into the installed repo\n");
      const release = await seedTestModuleRelease(resources, "web");
      const catalog = (await externalPackageCatalog(ports, workspaceId)).find(item => item.name === "web")!;
      expect(catalog.releaseHash).toBe(release.commit);
      expect(catalog.releaseHash).toBe(catalog.git?.commit ?? null);
      expect(() => git("cat-file", "-e", `${release.commit}^{commit}`)).toThrow();
    }
    const snapshot = () => readdirSync(directory, { recursive: true }).map(name => {
      const path = join(directory, String(name)), stat = statSync(path, { bigint: true });
      return [String(name), stat.mtimeNs, stat.size, stat.isFile() ? readFileSync(path) : null];
    });
    const before = snapshot();
    if (scenario !== "missing") expect(before.some(([name]) => String(name).startsWith(`platform/repos/${module.id}.git/`))).toBe(true);
    const current = await inspectExternalApps();
    // Other missing fixtures and the paused Remind release still produce catalog warnings.
    expect(current.status).toBe("warning");
    expect(current.message).toContain("pi: Release resources missing");
    if (["outdated", "unfetched"].includes(scenario)) {
      expect(current.message).toContain("web: bundled release differs from installed version; stop Chrona and run chrona admin install web --update --request-key <new-key>");
      expect(current.message).not.toContain("Could not compare web");
    } else if (["missing", "invalid"].includes(scenario)) {
      expect(current.message).toContain("Could not compare web with the bundled release:");
      expect(current.message).not.toContain("web: bundled release differs");
    } else {
      expect(current.message).not.toMatch(/(?:^|; )web:/);
      expect(current.message).not.toContain("Could not compare web");
    }
    expect(snapshot()).toEqual(before);
  } finally {
    await db.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("reports rejected updates and clears the error for the next candidate without writing data", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chrona-doctor-install-"));
  const databasePath = join(directory, "chrona-test.db");
  ensureSqliteDatabase({ databaseUrl: `file:${databasePath}`, migrationsDir: join(import.meta.dir, "../../../prisma/migrations") });
  const { PrismaClient } = await import("@chrona/db/generated/prisma/client");
  const { PrismaBunSqlite } = await import("prisma-adapter-bun-sqlite");
  const { seedTestModuleRelease } = await import("../../engine/src/modules/steward/module-release-test-fixture");
  const { testModuleSandbox } = await import("../../engine/src/modules/steward/module-test-process");
  const { createExternalModuleInstaller, installExternal, externalPackageCatalog, refreshInstallationReceipts } = await import("../../engine/src/modules/steward/module-install");
  const { buildPending } = await import("../../engine/src/modules/steward/module-build");
  const { moduleContext } = await import("../../engine/src/modules/steward/module-context");
  const db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: `file:${databasePath}` }) });
  try {
    const workspaceId = "ws_default";
    await db.workspace.create({ data: { id: workspaceId, name: "Doctor" } });
    const resources = join(directory, "external"), code = join(resources, "files");
    mkdirSync(code, { recursive: true });
    writeFileSync(join(code, "module.json"), JSON.stringify({ name: "files", entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [] }));
    writeFileSync(join(code, "index.ts"), "// synthetic fixture\n");
    writeFileSync(join(code, "test.ts"), "// offline fixture\n");
    await seedTestModuleRelease(resources, "files");
    const ports: import("../../engine/src/modules/steward/ports").StewardPorts = { db, dataDir: directory, now: () => new Date(), publicUrl: null, moduleExternalResources: resources, sandbox: testModuleSandbox(async () => ({ status: "succeeded", exitCode: 0, output: "{}", error: null })) };
    ports.moduleExternalInstaller = createExternalModuleInstaller(ports);
    const request = { package: "files" as const, mode: "install" as const, requestKey: "doctor-install" };
    const first = await installExternal(ports, workspaceId, request);
    expect(first.status).toBe("building");
    await buildPending(moduleContext(ports, workspaceId));
    await refreshInstallationReceipts(ports, workspaceId);
    const installed = await installExternal(ports, workspaceId, request);
    expect(installed.status).toBe("installed");
    const entry = (await externalPackageCatalog(ports, workspaceId)).find(item => item.name === "files")!;
    const module = await db.module.findUniqueOrThrow({ where: { id: installed.moduleId! } });
    expect(entry.releaseHash).toBe(module.activeHash);
    expect(entry.installation?.hash).toBe(entry.releaseHash);
    process.env.DATABASE_URL = `file:${databasePath}`;
    process.env.CHRONA_DATA_DIR = directory;
    process.env.CHRONA_RESOURCE_DIR = directory;
    const snapshot = () => readdirSync(directory, { recursive: true }).map(name => {
      const path = join(directory, String(name)), stat = statSync(path, { bigint: true });
      return [String(name), stat.mtimeNs, stat.size, stat.isFile() ? readFileSync(path) : null];
    });
    const before = snapshot();
    const current = await inspectExternalApps();
    // Other missing fixtures and the paused Remind release still produce catalog warnings.
    expect(current.status).toBe("warning");
    expect(current.message).not.toContain("files:");
    expect(current.message).toContain("pi: Release resources missing");
    expect(snapshot()).toEqual(before);
    const repo = join(directory, "platform", "repos", `${module.id}.git`);
    const git = (...args: string[]) => execFileSync("git", [`--git-dir=${repo}`, ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_AUTHOR_NAME: "Doctor test", GIT_AUTHOR_EMAIL: "doctor@localhost", GIT_COMMITTER_NAME: "Doctor test", GIT_COMMITTER_EMAIL: "doctor@localhost" },
    }).trim();
    const tree = git("rev-parse", `${entry.releaseHash}^{tree}`);
    const activeHash = git("commit-tree", tree, "-m", "Unrelated installed version");
    await db.module.update({ where: { id: module.id }, data: { activeHash } });
    const outdatedBefore = snapshot();
    const outdated = await inspectExternalApps();
    expect(outdated.status).toBe("warning");
    expect(outdated.message).toContain("files: bundled release differs from installed version; stop Chrona and run chrona admin install files --update --request-key <new-key>");
    expect(snapshot()).toEqual(outdatedBefore);
    await db.module.update({ where: { id: module.id }, data: { activeHash: installed.hash } });
    writeFileSync(join(code, "module.json"), JSON.stringify({ name: "files", description: "Rejected update", entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [] }));
    await seedTestModuleRelease(resources, "files");
    const update = await installExternal(ports, workspaceId, { package: "files", mode: "update", requestKey: "doctor-rejected" });
    const reason = "Type check index.ts:1 TS2322: Type string is not assignable to number";
    await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: module.id, hash: update.hash! } }, data: { status: "rejected", report: { tests: [], typecheck: { status: "failed", errors: [{ file: "index.ts", line: 1, code: 2322, message: reason }] } } } });
    // Doctor sees the build result without requiring a running server to refresh receipts.
    expect(update).toMatchObject({ status: "building", moduleId: module.id });
    expect((await externalPackageCatalog(ports, workspaceId)).find(entry => entry.name === "files")?.installation).toMatchObject({ hash: update.hash, error: { reason: "installation_rejected" } });
    const rejectedBefore = snapshot();
    const rejected = await inspectExternalApps();
    expect(rejected).toMatchObject({ key: "externalApps", status: "error" });
    expect(rejected.message).toContain(`files: update ${update.hash!.slice(0, 8)} was rejected: ${reason}`);
    expect(rejected.message).not.toContain("files: bundled release differs");
    expect(await inspectExternalApps()).toEqual(rejected);
    expect(snapshot()).toEqual(rejectedBefore);
    await refreshInstallationReceipts(ports, workspaceId);
    expect((await inspectExternalApps()).message).toContain(`files: update ${update.hash!.slice(0, 8)} was rejected: ${reason}`);
    writeFileSync(join(code, "module.json"), JSON.stringify({ name: "files", description: "Next update", entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [] }));
    await seedTestModuleRelease(resources, "files");
    await installExternal(ports, workspaceId, { package: "files", mode: "update", requestKey: "doctor-next-update" });
    const next = await inspectExternalApps();
    expect(next.status).toBe("warning");
    expect(next.message).not.toContain("was rejected");
  } finally {
    await db.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});
