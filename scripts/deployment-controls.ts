#!/usr/bin/env bun

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Database } from "bun:sqlite";

import { backupSqliteDatabase, restoreSqliteDatabase } from "../packages/db/src/sqlite-backup";
import { inspectSqliteRuntimeLock } from "../packages/db/src/sqlite-runtime-lock";
import { checksumSql } from "../packages/db/src/sqlite-migrations";
import { sqlitePathFromFileUrl } from "../packages/db/src/sqlite-url";
import { verifyReleaseIdentity } from "../build/release-identity";
import { buildTargets, type BuildTargetName } from "../build/manifest";
import { smokeRelease } from "../build/release-smoke";
import { findResourceDir } from "../packages/cli/src/start-server";

const TERMINAL_RUNS = ["finished", "failed", "cancelled", "timed_out", "provider_unavailable"];
const TERMINAL_INVOCATIONS = ["succeeded", "failed"];
const TERMINAL_CALLS = ["executed", "failed", "rejected"];
const REQUIRED_STATE_TABLES = ["_chrona_migrations", "Module", "Run", "ModuleInvocation", "ModuleCall", "ExecutionAttempt", "ExecutionDelivery", "ExecutionReceipt", "ExecutionCommand", "AgentCommand"];

export type DeploymentCheck = { key: string; status: "ok" | "error"; message: string; details?: unknown };
export type DeploymentReport = {
  schema: 1;
  operation: "preflight";
  releaseDir: string;
  dataDir: string;
  databasePath: string;
  process: { pid: number; executable: string; resourceRoot: string };
  activeModules: { name: string; activeHash: string | null; expectedHash: string | null; status: string }[];
  checks: DeploymentCheck[];
  passed: boolean;
};

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function required(args: string[], name: string): string {
  const value = option(args, name);
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name}`);
  return value;
}

function absolute(value: string, label: string): string {
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path`);
  return resolve(value);
}

function jsonFile(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must contain a JSON object`);
  return value as Record<string, unknown>;
}

function tables(db: Database): Set<string> {
  return new Set(db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
}

export type DataStateSummary = {
  unknownStops: number;
  unsettledRuns: number;
  unsettledInvocations: number;
  unsettledCalls: number;
  unsettledDeliveries: number;
  unsettledCommands: number;
  pendingCallbacks: number;
  unacceptedOutboundReceipts: number;
  unsettledExecutions: number;
  unresolvedWorkspaceCleanup: number;
};

export function summarizeDataState(db: Database): DataStateSummary {
  const present = tables(db);
  const missing = REQUIRED_STATE_TABLES.filter(table => !present.has(table));
  if (missing.length) throw new Error(`Database is missing required Chrona state table(s): ${missing.join(", ")}`);
  const count = (table: string, where: string) => Number((db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM "${table}" WHERE ${where}`).get()?.count ?? 0));
  const unknownStops = count("Run", `"stopStatus" = 'unknown'`) + count("ExecutionCommand", `"effect" = 'unknown'`);
  return {
    unknownStops,
    unsettledRuns: count("Run", `"status" NOT IN (${TERMINAL_RUNS.map(value => `'${value}'`).join(",")})`),
    unsettledInvocations: count("ModuleInvocation", `"status" NOT IN (${TERMINAL_INVOCATIONS.map(value => `'${value}'`).join(",")})`),
    unsettledCalls: count("ModuleCall", `"status" NOT IN (${TERMINAL_CALLS.map(value => `'${value}'`).join(",")})
      OR ("status" = 'failed' AND "error" IN ('unknown', 'internal'))`),
    unsettledDeliveries: count("ExecutionDelivery", `"settledAt" IS NULL`),
    unsettledCommands: count("AgentCommand", `"settled" = 0`),
    pendingCallbacks: count("ModuleInvocation", `"reply" = 1 AND "repliedAt" IS NULL`),
    unacceptedOutboundReceipts: count("ExecutionReceipt", `"direction" = 'outbound' AND "acceptedAt" IS NULL`),
    unsettledExecutions: count("ExecutionAttempt", `"stopConfirmedAt" IS NULL OR "heldDirectory" IS NOT NULL`),
    unresolvedWorkspaceCleanup: count("ExecutionCommand", `"operation" LIKE 'workspace-cleanup-%'
      AND (json_extract("receipt", '$.result') IS NULL OR json_extract("receipt", '$.result.state') = 'unknown')`),
  };
}

function processObservation(pid: number): DeploymentReport["process"] {
  if (process.platform !== "linux") throw new Error("Deployment preflight requires Linux /proc process evidence");
  const processRoot = `/proc/${pid}`;
  if (!existsSync(processRoot)) throw new Error(`Process ${pid} does not exist`);
  const executable = readlinkSync(`${processRoot}/exe`);
  const cwd = readlinkSync(`${processRoot}/cwd`);
  const environment = readFileSync(`${processRoot}/environ`).toString().split("\0").filter(Boolean);
  const envValue = (key: string) => environment.find(value => value.startsWith(`${key}=`))?.slice(key.length + 1);
  const command = readFileSync(`${processRoot}/cmdline`).toString().split("\0").filter(Boolean);
  const sourceEntry = command.map(value => resolve(cwd, value)).find(value => value.endsWith("/packages/cli/src/bun-entry.ts"));
  const packageDir = envValue("CHRONA_PACKAGE_DIR") ?? (sourceEntry ? resolve(dirname(sourceEntry), "../..") : undefined);
  const resourceRoot = resolve(cwd, findResourceDir({
    cwd, executable, argv0: command[0] ?? executable, resourceDir: envValue("CHRONA_RESOURCE_DIR"), packageDir,
  }));
  return { pid, executable, resourceRoot };
}

function candidateMigrations(releaseDir: string): { name: string; checksum: string }[] {
  const directory = join(releaseDir, "resources/prisma/migrations");
  if (!existsSync(directory)) throw new Error(`Release migrations missing: ${directory}`);
  return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => ({
    name: entry.name,
    checksum: checksumSql(readFileSync(join(directory, entry.name, "migration.sql"), "utf8")),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function migrationCheck(db: Database, releaseDir: string): DeploymentCheck {
  const present = tables(db);
  if (!present.has("_chrona_migrations")) return { key: "migrationCompatibility", status: "error", message: "Database has no tracked Chrona migration baseline; deployment refuses an untracked database." };
  const applied = db.query<{ name: string; checksum: string }, []>('SELECT name, checksum FROM "_chrona_migrations" ORDER BY name').all();
  const candidate = candidateMigrations(releaseDir);
  for (const [index, prior] of applied.entries()) {
    const expected = candidate.at(index);
    if (expected === undefined || expected.name !== prior.name || expected.checksum !== prior.checksum) {
      return { key: "migrationCompatibility", status: "error", message: `Applied migration ${prior.name} is incompatible with the candidate; one-off storage conversion is not automatic.` };
    }
  }
  return { key: "migrationCompatibility", status: "ok", message: `${candidate.length - applied.length} candidate migration(s) remain; no conversion or replay is performed.` };
}

function releaseModules(releaseDir: string): Map<string, string> {
  const lock = jsonFile(join(releaseDir, "resources/module-git/lock.json"));
  if (!Array.isArray(lock.modules)) throw new Error("Candidate module lock has no modules array");
  return new Map(lock.modules.map(module => {
    if (!module || typeof module !== "object" || typeof (module as { name?: unknown }).name !== "string" || typeof (module as { commit?: unknown }).commit !== "string") throw new Error("Candidate module lock contains an invalid identity");
    return [(module as { name: string }).name, (module as { commit: string }).commit];
  }));
}

// eslint-disable-next-line complexity -- this is the single read-only deployment gate aggregating independent evidence.
export async function runPreflight(args: string[]): Promise<DeploymentReport> {
  const releaseDir = absolute(required(args, "--release-dir"), "release directory");
  const dataDir = absolute(required(args, "--data-dir"), "data directory");
  const databaseUrl = required(args, "--database-url");
  const databasePath = sqlitePathFromFileUrl(databaseUrl);
  if (!databasePath || databasePath === ":memory:") throw new Error("--database-url must be a persistent SQLite file URL");
  const resolvedDatabasePath = resolve(databasePath);
  const pid = Number(required(args, "--pid"));
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("--pid must be a positive process id");
  const activeResourceRoot = absolute(required(args, "--active-resource-root"), "active resource root");
  await verifyReleaseIdentity(releaseDir);
  const lock = inspectSqliteRuntimeLock(databaseUrl);
  if (lock.state !== "live" || lock.pid !== pid) throw new Error(`Database runtime lock is not owned by requested process ${pid}`);
  const process = processObservation(pid);
  if (!existsSync(resolvedDatabasePath)) throw new Error(`Chrona database was not found: ${resolvedDatabasePath}`);
  const db = new Database(resolvedDatabasePath, { readonly: true });
  try {
    const checks: DeploymentCheck[] = [];
    checks.push({ key: "releaseIdentity", status: "ok", message: "Candidate release identity and payload bytes match." });
    checks.push({ key: "processResourceRoot", status: process.resourceRoot === activeResourceRoot ? "ok" : "error", message: process.resourceRoot === activeResourceRoot ? `PID ${pid} uses the expected resource root.` : `PID ${pid} uses ${process.resourceRoot}, expected ${activeResourceRoot}.` });
    checks.push({ key: "databaseOwner", status: "ok", message: `Database ${resolvedDatabasePath} is owned by PID ${pid}.` });
    checks.push(migrationCheck(db, releaseDir));
    const state = summarizeDataState(db);
    checks.push({ key: "unknownStops", status: state.unknownStops === 0 ? "ok" : "error", message: state.unknownStops === 0 ? "No unknown stop or unknown execution command is retained." : `${state.unknownStops} unknown stop/effect record(s) remain; deployment is blocked.` });
    const unsettled = state.unsettledRuns + state.unsettledInvocations + state.unsettledCalls
      + state.unsettledDeliveries + state.unsettledCommands + state.pendingCallbacks
      + state.unacceptedOutboundReceipts + state.unsettledExecutions + state.unresolvedWorkspaceCleanup;
    checks.push({ key: "unsettledWork", status: unsettled === 0 ? "ok" : "error", message: unsettled === 0 ? "Runs, invocations, calls, deliveries, commands, callbacks and cleanup receipts are settled." : `${unsettled} unsettled row(s) remain; deployment is blocked.` , details: state });
    const expected = releaseModules(releaseDir);
    const activeModules = db.query<{ name: string; activeHash: string | null; status: string }, []>('SELECT name, activeHash, status FROM "Module" ORDER BY name').all().map(module => ({ ...module, expectedHash: expected.get(module.name) ?? null }));
    checks.push({ key: "activeHashes", status: "ok", message: "Active module hashes were read from the target database; differences are reported for controlled activation.", details: activeModules.map(module => ({ name: module.name, activeHash: module.activeHash, expectedHash: module.expectedHash, status: module.status })) });
    const report: DeploymentReport = { schema: 1, operation: "preflight", releaseDir, dataDir, databasePath: resolvedDatabasePath, process, activeModules, checks, passed: checks.every(check => check.status !== "error") };
    const reportPath = option(args, "--report");
    if (reportPath) {
      const destination = absolute(reportPath, "report path");
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    }
    return report;
  } finally { db.close(); }
}

export async function acceptRelease(args: string[]) {
  const releaseDir = absolute(required(args, "--release-dir"), "release directory");
  const target = required(args, "--target") as BuildTargetName;
  if (!(target in buildTargets)) throw new Error(`Unknown release target: ${target}`);
  const expectedDir = resolve(dirname(releaseDir), buildTargets[target].releaseName);
  if (releaseDir !== expectedDir) throw new Error(`Release directory must be the standard target directory: ${expectedDir}`);
  await smokeRelease(target, { releaseRoot: dirname(releaseDir), runtime: args.includes("--runtime") });
  return { schema: 1, operation: "offline-acceptance", releaseDir, target, runtime: args.includes("--runtime"), passed: true };
}

function usage(): never {
  throw new Error("Usage: bun scripts/deployment-controls.ts <preflight|backup|accept> ...");
}

async function runBackup(args: string[]) {
  const databaseUrl = required(args, "--database-url");
  const dataDir = absolute(required(args, "--data-dir"), "data directory");
  const output = absolute(required(args, "--output"), "backup output");
  const result = backupSqliteDatabase(databaseUrl, output, dataDir);
  const verificationRoot = mkdtempSync(join(dirname(output), ".chrona-backup-check-"));
  try {
    restoreSqliteDatabase(`file:${join(verificationRoot, "chrona.db")}`, output, { dataDir: verificationRoot });
  } finally { rmSync(verificationRoot, { recursive: true, force: true }); }
  return { schema: 1, operation: "backup-and-restore-check", ...result, archive: `${result.backupPath}.tar`, verified: true };
}

async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);
  if (command === "preflight") {
    const report = await runPreflight(args);
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  } else if (command === "backup") console.log(JSON.stringify(await runBackup(args), null, 2));
  else if (command === "accept") console.log(JSON.stringify(await acceptRelease(args), null, 2));
  else usage();
}

if (import.meta.main) main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  if (process.argv[2] === "preflight") console.log(JSON.stringify({ schema: 1, operation: "preflight", passed: false, error: message }, null, 2));
  console.error(JSON.stringify({ component: "deployment-controls", event: "command_failed", error: message }));
  process.exitCode = 1;
});
