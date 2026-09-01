#!/usr/bin/env bun

import { copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";

import { buildTargets, parseBuildTarget, type BuildTargetName } from "../build/manifest";
import { schemaFingerprint } from "../packages/db/src/sqlite-schema-fingerprint";
import { verifyMigrationReleaseMetadata } from "../packages/db/src/sqlite-migrations";
import { sqliteRuntimeLockPath } from "../packages/db/src/sqlite-runtime-lock";
import { secureWindowsGeneratedStorage } from "../packages/db/src/windows-private-storage";

const ROOT = resolve(import.meta.dirname, "..");
const TIMEOUT_MS = 25_000;
const MIGRATIONS_DIR = resolve(ROOT, "prisma/migrations");

function loadReleaseMetadata() {
  const value = verifyMigrationReleaseMetadata(MIGRATIONS_DIR);
  if (!value) {
    throw new Error(`Migration release metadata is missing from ${MIGRATIONS_DIR}.`);
  }
  return value;
}

const metadata = loadReleaseMetadata();

async function freePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = server.port;
  server.stop(true);
  if (port === undefined) {
    throw new Error("Bun did not allocate a port for the packaged upgrade smoke server.");
  }
  return port;
}

async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  let detail = "not requested";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
      detail = `${response.status} ${await response.text()}`;
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(200);
  }
  throw new Error(`Packaged upgrade runtime did not become healthy: ${detail}`);
}

function binaryFor(target: BuildTargetName): string {
  const config = buildTargets[target];
  return resolve(ROOT, "dist/releases", config.releaseName, config.binaryName);
}

function releaseEnvironment(dataDir: string, configDir: string, databasePath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CHRONA_DATA_DIR: dataDir,
    CHRONA_CONFIG_DIR: configDir,
    DATABASE_URL: `file:${databasePath}`,
    CHRONA_NO_OPEN: "1",
    CHRONA_EXPERIMENTAL_DASHBOARD_AI_SUMMARY: "0",
  };
}

function seedRepresentativeLegacyRows(path: string): void {
  const db = new Database(path);
  const now = new Date().toISOString();
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.query("INSERT INTO Workspace (id, name, description, defaultRuntime, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("upgrade-workspace", "Packaged upgrade workspace", "v0.2.0 representative", "debug", "Active", now, now);
    db.query("INSERT INTO Task (id, workspaceId, title, executionRuntime, executionConfig, status, priority, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("upgrade-task", "upgrade-workspace", "Packaged upgrade representative", "debug", "{}", "Inbox", "Medium", now, now);
  } finally {
    db.close();
  }
}

function assertUpgradedDatabase(path: string, expectedTitle: string): void {
  const db = new Database(path, { readonly: true });
  try {
    const history = db.query<{ migration_name: string }, []>("SELECT migration_name FROM _prisma_migrations ORDER BY finished_at, migration_name").all();
    if (!history.some((row) => row.migration_name === metadata.mutableReleaseLineMigration)) {
      throw new Error(`Release-line migration ${metadata.mutableReleaseLineMigration} missing from packaged upgrade history.`);
    }
    if (schemaFingerprint(db) !== metadata.releaseLineSchemaFingerprint) {
      throw new Error("Packaged upgrade schema fingerprint does not match release metadata.");
    }
    const integrity = db.query<{ quick_check: string }, []>("PRAGMA quick_check").get();
    const foreignKeys = db.query<{ foreign_key_check: string }, []>("PRAGMA foreign_key_check").all();
    if (integrity?.quick_check !== "ok" || foreignKeys.length !== 0) throw new Error("Packaged upgraded database failed integrity or foreign-key checks.");
    const task = db.query<{ title: string }, []>("SELECT title FROM Task WHERE id = 'upgrade-task'").get();
    if (task?.title !== expectedTitle) throw new Error(`Representative task mismatch: expected ${expectedTitle}, got ${task?.title ?? "missing"}.`);
    const archived = db.query<{ legacyRuntime: string }, []>("SELECT legacyRuntime FROM LegacyRuntimeSelectorArchive WHERE entityType = 'task' AND entityId = 'upgrade-task'").get();
    if (archived?.legacyRuntime !== "debug") throw new Error("LegacyRuntimeSelectorArchive did not preserve representative task runtime.");
  } finally {
    db.close();
  }
}

async function runCommand(binary: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const process = Bun.spawn([binary, ...args], { cwd: ROOT, env, stdout: "pipe", stderr: "pipe" });
  const code = await process.exited;
  if (code !== 0) {
    throw new Error(`Packaged command ${args.join(" ")} failed (${code}):\n${await new Response(process.stdout).text()}\n${await new Response(process.stderr).text()}`);
  }
}

async function stopSmokeProcess(process: Bun.Subprocess, env: NodeJS.ProcessEnv): Promise<void> {
  process.kill();
  await process.exited.catch(() => undefined);
  if (env.DATABASE_URL) rmSync(sqliteRuntimeLockPath(env.DATABASE_URL), { force: true });
}

async function startAndStop(binary: string, env: NodeJS.ProcessEnv): Promise<void> {
  const port = await freePort();
  const process = Bun.spawn([binary, "start", "--host", "127.0.0.1", "--port", String(port), "--no-open"], { cwd: ROOT, env, stdout: "pipe", stderr: "pipe" });
  try {
    await waitForHealth(port);
  } catch (error) {
    await stopSmokeProcess(process, env);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${await new Response(process.stdout).text()}\n${await new Response(process.stderr).text()}`,
      { cause: error },
    );
  }
  await stopSmokeProcess(process, env);
}

export async function smokePackagedUpgrade(target: BuildTargetName): Promise<void> {
  const binary = binaryFor(target);
  if (!existsSync(binary)) throw new Error(`Built release binary missing: ${binary}`);
  const root = mkdtempSync(join(tmpdir(), "chrona-packaged-upgrade-"));
  const dataDir = join(root, "data");
  const configDir = join(root, "config");
  const databasePath = join(dataDir, "chrona.db");
  const backupPath = join(dataDir, "upgrade-backup.sqlite");
  try {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });
    if (process.platform === "win32") {
      secureWindowsGeneratedStorage(dataDir, true);
      secureWindowsGeneratedStorage(configDir, true);
    }
    copyFileSync(resolve(MIGRATIONS_DIR, metadata.previousReleaseFixture.path), databasePath);
    if (process.platform === "win32") secureWindowsGeneratedStorage(databasePath, false);
    seedRepresentativeLegacyRows(databasePath);
    const env = releaseEnvironment(dataDir, configDir, databasePath);
    await startAndStop(binary, env);
    assertUpgradedDatabase(databasePath, "Packaged upgrade representative");
    await runCommand(binary, ["backup", backupPath], env);
    const db = new Database(databasePath);
    db.query("UPDATE Task SET title = ? WHERE id = 'upgrade-task'").run("mutated after packaged backup");
    db.close();
    assertUpgradedDatabase(databasePath, "mutated after packaged backup");
    await runCommand(binary, ["restore", backupPath, "--force"], env);
    await startAndStop(binary, env);
    assertUpgradedDatabase(databasePath, "Packaged upgrade representative");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  console.log(`✓ Packaged upgrade/backup/restore smoke passed for ${target}`);
}

if (import.meta.main) {
  smokePackagedUpgrade(parseBuildTarget(process.argv.slice(2))).catch((error) => {
    console.error("Packaged upgrade smoke failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
