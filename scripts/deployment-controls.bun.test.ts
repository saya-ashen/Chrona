import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { writeReleaseIdentity } from "../build/release-identity";
import { acquireSqliteRuntimeLock } from "../packages/db/src/sqlite-runtime-lock";
import { ensureSqliteDatabase } from "../packages/db/src/sqlite-migrations";
import { restoreSqliteDatabase } from "../packages/db/src/sqlite-backup";
import { acceptRelease, runPreflight, summarizeDataState } from "./deployment-controls";

const script = join(import.meta.dir, "deployment-controls.ts");
const migrationsDir = join(import.meta.dir, "../prisma/migrations");
const runSql = `INSERT INTO Run (id, workspaceId, lane, trigger, status, provider, tokenHash, prompt, cwd)
  VALUES ('run', 'workspace', 'coding', 'manual', 'finished', 'test', 'test-token', 'fixture', '/tmp');`;
const executionSql = `INSERT INTO ExecutionAttempt
  (id, workspaceId, ownerId, callerKey, workId, commandKey, requestDigest, runId, projectRef, projectDigest, logDir, baseline, budget, stopConfirmedAt, stopEvidence)
  VALUES ('attempt', 'workspace', 'owner', 'owner', 'work', 'key', 'digest', 'run', 'project', 'digest', '/tmp', 'baseline', '{}', CURRENT_TIMESTAMP, '{"kind":"never_started"}');`;
const deliverySql = `INSERT INTO ExecutionAuthority
  (id, workspaceId, ownerId, receiverModuleId, receiverHash, receiverActivationId, subjectId, epoch, keyId, publicKey, verifierId, verifierVersion, scope, approvalId, approvedAt)
  VALUES ('authority', 'workspace', 'owner', 'module', 'hash', 'activation', 'subject', 1, 'key', 'public', 'verifier', '1', '{}', 'approval', CURRENT_TIMESTAMP);
  INSERT INTO ExecutionDelivery (id, attemptId, authorityId, receiverModuleId, receiverHash, receiverActivationId, launchDigest, launch, settledAt)
  VALUES ('delivery', 'attempt', 'authority', 'module', 'hash', 'activation', 'digest', '{}', CURRENT_TIMESTAMP);`;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chrona-deployment-test-"));
  const dataDir = join(root, "data"), databasePath = join(root, "external", "live.db");
  await mkdir(dataDir);
  const databaseUrl = `file:${databasePath}?connection_limit=1`;
  ensureSqliteDatabase({ databaseUrl, migrationsDir });
  const db = new Database(databasePath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("INSERT INTO Workspace (id, name, updatedAt) VALUES ('workspace', 'fixture', CURRENT_TIMESTAMP)");
  return { root, dataDir, databasePath, databaseUrl, db, async close() { db.close(); await rm(root, { recursive: true, force: true }); } };
}

async function releaseFixture(root: string) {
  const release = join(root, "chrona-linux-x64");
  await mkdir(join(release, "resources/module-git"), { recursive: true });
  await mkdir(join(release, "resources/prisma/migrations/0001_initial"), { recursive: true });
  await writeFile(join(release, "resources/module-git/lock.json"), JSON.stringify({ version: 1, modules: [] }));
  await writeFile(join(release, "resources/prisma/migrations/0001_initial/migration.sql"), await Bun.file(join(migrationsDir, "0001_initial/migration.sql")).text());
  await writeReleaseIdentity(release, process.cwd());
  return release;
}

function cli(command: string, args: string[]) {
  return spawnSync(process.execPath, [script, command, ...args], { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 });
}

test.each(["finished", "failed", "cancelled", "timed_out", "provider_unavailable"])("terminal %s retains never-started settlement", async status => {
  const f = await fixture();
  try {
    f.db.exec(runSql + executionSql);
    f.db.run("UPDATE Run SET status = ?", [status]);
    expect(summarizeDataState(f.db)).toMatchObject({ unknownStops: 0, unsettledRuns: 0, unsettledExecutions: 0 });
  } finally { await f.close(); }
});

test.each(["queued", "running", "waiting", "unknown"])("nonterminal %s blocks work", async status => {
  const f = await fixture();
  try {
    f.db.exec(runSql);
    f.db.run("UPDATE Run SET status = ?", [status]);
    expect(summarizeDataState(f.db).unsettledRuns).toBe(1);
  } finally { await f.close(); }
});

test("terminal runs still block unknown stop, held directories and unconfirmed execution stops", async () => {
  const f = await fixture();
  try {
    f.db.exec(runSql + executionSql);
    f.db.exec("UPDATE Run SET stopStatus = 'unknown'; UPDATE ExecutionAttempt SET heldDirectory = '/tmp/work'");
    expect(summarizeDataState(f.db)).toMatchObject({ unknownStops: 1, unsettledExecutions: 1 });
    f.db.exec("UPDATE ExecutionAttempt SET heldDirectory = NULL, stopConfirmedAt = NULL");
    expect(summarizeDataState(f.db).unsettledExecutions).toBe(1);
  } finally { await f.close(); }
});

test.each(["succeeded", "failed"])("terminal invocation %s blocks until its callback is handled", async status => {
  const f = await fixture();
  try {
    f.db.run(`INSERT INTO ModuleInvocation (id, workspaceId, caller, target, tool, args, key, mode, status, reply, replyAttempts)
      VALUES ('callback', 'workspace', 'module:fixture', 'other', 'read', '{}', 'key', 'async', ?, 1, 3)`, [status]);
    expect(summarizeDataState(f.db)).toMatchObject({ pendingCallbacks: 1, unsettledInvocations: 0 });
    f.db.exec("UPDATE ModuleInvocation SET repliedAt = CURRENT_TIMESTAMP");
    expect(summarizeDataState(f.db).pendingCallbacks).toBe(0);
  } finally { await f.close(); }
});

test.each(["cleanup", "control", "final"])("settled delivery blocks unaccepted outbound %s receipts", async operation => {
  const f = await fixture();
  try {
    f.db.exec(runSql + executionSql + deliverySql);
    f.db.run(`INSERT INTO ExecutionReceipt (id, deliveryId, operation, requestKey, requestDigest, direction, receipt)
      VALUES ('receipt', 'delivery', ?, 'key', 'digest', 'outbound', '{}')`, [operation]);
    expect(summarizeDataState(f.db)).toMatchObject({ unsettledDeliveries: 0, unacceptedOutboundReceipts: 1 });
    f.db.exec("UPDATE ExecutionReceipt SET acceptedAt = CURRENT_TIMESTAMP");
    expect(summarizeDataState(f.db).unacceptedOutboundReceipts).toBe(0);
  } finally { await f.close(); }
});

test.each(["{}", '{"result":{"state":"unknown"}}', '{"result":{"state":"removed"}}'])("workspace cleanup follows lifecycle receipt %s", async receipt => {
  const f = await fixture();
  try {
    f.db.exec(runSql + executionSql);
    f.db.run(`INSERT INTO ExecutionCommand (attemptId, commandKey, operation, requestDigest, receipt)
      VALUES ('attempt', 'key', 'workspace-cleanup-confirm', 'digest', ?)`, [receipt]);
    expect(summarizeDataState(f.db).unresolvedWorkspaceCleanup).toBe(receipt.includes("removed") ? 0 : 1);
    f.db.exec("UPDATE ExecutionCommand SET effect = 'unknown'");
    expect(summarizeDataState(f.db).unknownStops).toBe(1);
  } finally { await f.close(); }
});

test.each(["Run", "ExecutionAttempt", "ModuleInvocation", "ModuleCall", "ExecutionDelivery", "ExecutionReceipt", "ExecutionCommand", "AgentCommand"])("missing %s fails even with tracked migration history", async table => {
  const f = await fixture();
  try {
    f.db.exec(`DROP TABLE "${table}"`);
    expect(() => summarizeDataState(f.db)).toThrow(`missing required Chrona state table(s): ${table}`);
  } finally { await f.close(); }
});

async function observedOwner(f: Awaited<ReturnType<typeof fixture>>, release: string) {
  const lockSource = join(import.meta.dir, "../packages/db/src/sqlite-runtime-lock.ts");
  const child = Bun.spawn([process.execPath, "-e", `import { acquireSqliteRuntimeLock } from ${JSON.stringify(lockSource)};
    const lock = acquireSqliteRuntimeLock(process.env.DATABASE_URL);
    process.on('exit', () => lock.release()); console.log('ready'); setInterval(() => {}, 1000);`], {
    cwd: f.root, env: { ...process.env, DATABASE_URL: f.databaseUrl, CHRONA_RESOURCE_DIR: "chrona-linux-x64/resources" }, stdout: "pipe", stderr: "pipe",
  });
  const ready = await child.stdout.getReader().read();
  expect(new TextDecoder().decode(ready.value)).toContain("ready");
  const args = ["--release-dir", release, "--data-dir", f.dataDir, "--database-url", f.databaseUrl,
    "--pid", String(child.pid), "--active-resource-root", join(release, "resources")];
  return { child, args };
}

test("preflight CLI binds PID, external database and resource root, and failed checks exit nonzero with JSON", async () => {
  const f = await fixture(), release = await releaseFixture(f.root);
  const { child, args } = await observedOwner(f, release);
  try {
    const success = cli("preflight", args);
    expect(success.status).toBe(0);
    expect(JSON.parse(success.stdout)).toMatchObject({ passed: true, databasePath: f.databasePath, process: { pid: child.pid, resourceRoot: join(release, "resources") } });
    const wrongPid = [...args]; wrongPid[wrongPid.indexOf("--pid") + 1] = String(process.pid);
    await expect(runPreflight(wrongPid)).rejects.toThrow("not owned by requested process");
    f.db.exec(runSql + "UPDATE Run SET stopStatus = 'unknown'");
    const failed = cli("preflight", args);
    expect(failed.status).toBe(1);
    expect(JSON.parse(failed.stdout)).toMatchObject({ passed: false, checks: expect.arrayContaining([expect.objectContaining({ key: "unknownStops", status: "error" })]) });
    f.db.exec("UPDATE Run SET stopStatus = 'confirmed'");
    const wrongRoot = [...args]; wrongRoot[wrongRoot.indexOf("--active-resource-root") + 1] = join(f.root, "wrong");
    expect(JSON.parse(cli("preflight", wrongRoot).stdout)).toMatchObject({ passed: false });
    f.db.exec("UPDATE _chrona_migrations SET checksum = 'incompatible'");
    const incompatible = cli("preflight", args);
    expect(incompatible.status).toBe(1);
    expect(JSON.parse(incompatible.stdout)).toMatchObject({ passed: false, checks: expect.arrayContaining([expect.objectContaining({ key: "migrationCompatibility", status: "error" })]) });
    f.db.exec("DROP TABLE AgentCommand");
    const missing = cli("preflight", args);
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stdout)).toMatchObject({ passed: false, error: expect.stringContaining("AgentCommand") });
  } finally { child.kill(); await child.exited; await f.close(); }
});

test.each(["unknown", "internal", "forbidden", null])("preflight CLI follows ModuleCall failed error %s settlement", async error => {
  const f = await fixture(), release = await releaseFixture(f.root);
  const { child, args } = await observedOwner(f, release);
  try {
    f.db.run(`INSERT INTO ModuleCall (id, hash, method, key, status, error)
      VALUES ('call', 'hash', 'exec', 'key', 'failed', ?)`, [error]);
    const blocked = error === "unknown" || error === "internal";
    const result = cli("preflight", args);
    expect(result.status).toBe(blocked ? 1 : 0);
    expect(JSON.parse(result.stdout)).toMatchObject({ passed: !blocked, checks: expect.arrayContaining([
      expect.objectContaining({ key: "unsettledWork", status: blocked ? "error" : "ok", details: expect.objectContaining({ unsettledCalls: blocked ? 1 : 0 }) }),
    ]) });
  } finally { child.kill(); await child.exited; await f.close(); }
});

test("preflight CLI observes the source entry's implicit package fallback without overrides", async () => {
  const f = await fixture(), release = await releaseFixture(f.root);
  const sourceDir = join(f.root, "packages/cli/src"), resources = join(f.root, "packages/resources");
  await mkdir(sourceDir, { recursive: true });
  await mkdir(join(resources, "prisma/migrations"), { recursive: true });
  const startup = await readFile(join(import.meta.dir, "../packages/cli/src/start-server.ts"), "utf8");
  // Keep the real launcher's default resolution in the fixture; only relocate its dependency import.
  await writeFile(join(sourceDir, "start-server.ts"), startup.replace('"@chrona/db/sqlite-url"', JSON.stringify(join(import.meta.dir, "../packages/db/src/sqlite-url.ts"))));
  await writeFile(join(sourceDir, "bun-entry.ts"), `import { findResourceDir } from './start-server';
    import { acquireSqliteRuntimeLock } from ${JSON.stringify(join(import.meta.dir, "../packages/db/src/sqlite-runtime-lock.ts"))};
    const lock = acquireSqliteRuntimeLock(process.env.DATABASE_URL);
    process.on('exit', () => lock.release()); console.log(findResourceDir()); setInterval(() => {}, 1000);`);
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: f.databaseUrl };
  delete env.CHRONA_RESOURCE_DIR;
  delete env.CHRONA_PACKAGE_DIR;
  const child = Bun.spawn([process.execPath, join(sourceDir, "bun-entry.ts")], { cwd: f.root, env, stdout: "pipe", stderr: "pipe" });
  try {
    const ready = await child.stdout.getReader().read();
    expect(new TextDecoder().decode(ready.value).trim()).toBe(resources);
    const result = cli("preflight", ["--release-dir", release, "--data-dir", f.dataDir, "--database-url", f.databaseUrl,
      "--pid", String(child.pid), "--active-resource-root", resources]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ passed: true, process: { resourceRoot: resources } });
  } finally { child.kill(); await child.exited; await f.close(); }
});

test("preflight CLI argument failure remains JSON and nonzero", () => {
  const result = cli("preflight", []);
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ operation: "preflight", passed: false });
});

test("accept rejects the wrong requested directory even with a valid sibling identity", async () => {
  const f = await fixture();
  try {
    await releaseFixture(f.root);
    for (const name of ["wrong-release", "chrona-linux-arm64"]) {
      await expect(acceptRelease(["--release-dir", join(f.root, name), "--target", "linux-x64"])).rejects.toThrow("standard target directory");
    }
  } finally { await f.close(); }
});

test("backup CLI restores the selected external database and all four controlled roots", async () => {
  const f = await fixture(), output = join(f.root, "backup.db"), restored = join(f.root, "restored");
  try {
    for (const name of ["platform", "sessions", "secrets", "qq-bot"]) {
      await mkdir(join(f.dataDir, name), { recursive: true });
      await writeFile(join(f.dataDir, name, "fixture.txt"), `synthetic-${name}`);
    }
    const result = cli("backup", ["--database-url", f.databaseUrl, "--data-dir", f.dataDir, "--output", output]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ verified: true, sourcePath: f.databasePath });
    restoreSqliteDatabase(`file:${join(restored, "chrona.db")}`, output, { dataDir: restored });
    const db = new Database(join(restored, "chrona.db"), { readonly: true });
    try { expect(db.query("SELECT name FROM Workspace").get()).toEqual({ name: "fixture" }); } finally { db.close(); }
    for (const name of ["platform", "sessions", "secrets", "qq-bot"]) expect(await readFile(join(restored, name, "fixture.txt"), "utf8")).toBe(`synthetic-${name}`);
  } finally { await f.close(); }
});

test("backup CLI refuses a live database runtime lock", async () => {
  const f = await fixture(), lock = acquireSqliteRuntimeLock(f.databaseUrl);
  try {
    const result = cli("backup", ["--database-url", f.databaseUrl, "--data-dir", f.dataDir, "--output", join(f.root, "backup.db")]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: expect.stringContaining("already in use") });
    expect(await Bun.file(join(f.root, "backup.db")).exists()).toBe(false);
  } finally { lock.release(); await f.close(); }
});
