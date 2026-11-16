import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checksumSql, ensureSqliteDatabase } from "../../../packages/db/src/sqlite-migrations";
import { createAgentConversations } from "../../../packages/engine/src/modules/steward/entry-app/conversations";
import { CoreMindStore } from "../../../packages/engine/src/modules/steward/applications/mind/core-store";
import { CoreMindService } from "../../../packages/engine/src/modules/steward/applications/mind/core-service";
import { CoreRecovery } from "../../../packages/engine/src/modules/steward/applications/mind/core-recovery";
import { CoreExecutionJournal } from "../../../packages/engine/src/modules/steward/applications/mind/core-execution";
import { migrateStorage } from "./migrate";

setDefaultTimeout(20_000);
const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
const legacySql = readFileSync(join(import.meta.dir, "fixtures/legacy-initial.sql"), "utf8");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "chrona-offline-conversion-"));
  chmodSync(root, 0o700);
  directories.push(root);
  const source = join(root, "old"), destination = join(root, "converted");
  mkdirSync(source, { mode: 0o700 });
  const path = join(source, "chrona.db"), db = new Database(path, { create: true });
  chmodSync(path, 0o600);
  db.exec(legacySql);
  db.exec("CREATE TABLE _chrona_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL,appliedAt TEXT DEFAULT CURRENT_TIMESTAMP)");
  db.query("INSERT INTO _chrona_migrations(name,checksum) VALUES('0001_initial',?)").run(checksumSql(legacySql));
  db.exec(`INSERT INTO Workspace(id,name,settings,updatedAt) VALUES('w','test','{"custom":"preserve"}',CURRENT_TIMESTAMP);
    INSERT INTO Module(id,workspaceId,name,activationId) VALUES('app','w','mind','epoch');
    INSERT INTO Run(id,workspaceId,lane,trigger,status,stopStatus,provider,tokenHash,prompt,cwd)
      VALUES('run','w','foreground','test','unknown','unknown','pi','token-hash','original prompt','/original/sessions/run');
    INSERT INTO ModuleInvocation(id,workspaceId,caller,target,targetIdentity,targetBound,tool,args,key,requestDigest,mode,status,reply)
      VALUES('receipt','w','owner','mind','app',1,'write','{"text":"exact"}','consumed-key','digest','sync','unknown',1);
    INSERT INTO Schedule(id,workspaceId,moduleId,mode,text,rule,payload,status,nextAt,createdBy)
      VALUES('original-timer-id','w','app','timer','daily','{"revision":"original"}','{"message":"preserve"}','paused','2026-11-18T00:00:00Z','module');
    INSERT INTO Schedule(id,workspaceId,mode,text,rule,createdBy) VALUES('calendar','w','once','legacy reminder','{}','owner');
    INSERT INTO Preference(id,workspaceId,text,origin) VALUES('preference','w','legacy preference','owner');`);
  db.close();
  return { root, source, destination };
}
function privateDb(source: string, file: string, sql: string) {
  const path = join(source, "platform/data/app", file);
  mkdirSync(resolve(path, ".."), { recursive: true, mode: 0o700 });
  const db = new Database(path, { create: true });
  chmodSync(path, 0o600);
  db.exec(sql);
  return db;
}
function session() {
  return { id: "web-agent:one", key: "one", title: "保留的对话", status: "active", source: "web", createdAt: "2026-11-16T00:00:00Z",
    lastActivityAt: "2026-11-16T00:00:00Z", contextId: "context", messages: [{ id: "message", text: "原始内容", attachments: [] }],
    turns: [{ id: "turn", status: "unknown", active: true, runId: "run", cursor: "42", baseline: [], transcript: [], interactions: [],
      applicationDelivery: [], pendingToolResults: ["receipt"], runRequest: { prompt: "fixed prompt", tools: [], content: [] } }] };
}
async function assertFailure(f: ReturnType<typeof fixture>, message: string) {
  let failure: Error | undefined;
  try { await migrateStorage(f.source, f.destination); }
  catch (error) { failure = error as Error; }
  expect(failure?.message).toContain("Conversion failed");
  expect(String(failure?.cause)).toContain(message);
  expect(existsSync(f.destination)).toBe(false);
  const stage = readdirSync(f.root).find(name => name.startsWith("converted.converting-"))!;
  expect(JSON.parse(readFileSync(join(f.root, stage, "migration-report.json"), "utf8")).status).toBe("failed");
  const db = new Database(join(f.source, "chrona.db"), { readonly: true });
  try { expect(db.query("SELECT key FROM ModuleInvocation").get()).toEqual({ key: "consumed-key" }); }
  finally { db.close(); }
}

test("offline migration preserves authority, WAL state, all Mind journals and entry recovery data", async () => {
  const f = fixture();
  const appData = join(f.source, "platform/data/app");
  const kernelWal = new Database(join(f.source, "chrona.db"));
  kernelWal.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
    UPDATE ModuleInvocation SET output='{"fixed":"receipt"}';
    INSERT INTO Run(id,workspaceId,lane,trigger,status,stopStatus,provider,tokenHash,prompt,cwd)
      VALUES('queued-remote','w','background','execution','queued','pending','pi','queued-token','remote prompt','/original/remote');
    INSERT INTO ExecutionAttempt(id,workspaceId,ownerId,callerKey,moduleId,workId,commandKey,requestDigest,runId,projectRef,projectDigest,logDir,baseline,budget)
      VALUES('queued-attempt','w','app','queued-caller','app','queued-work','queued-command','queued-digest','queued-remote','project','project-digest','/original/logs','baseline','{"maxCalls":3}');
    INSERT INTO ExecutionAttempt(id,workspaceId,ownerId,callerKey,moduleId,workId,commandKey,requestDigest,runId,projectRef,projectDigest,logDir,baseline,budget)
      VALUES('attempt','w','app','caller','app','work','command','digest','run','project','project-digest','/original/logs','baseline','{"maxCalls":3}');
    INSERT INTO ExecutionAuthority(id,workspaceId,ownerId,receiverModuleId,receiverHash,receiverActivationId,subjectId,epoch,keyId,publicKey,verifierId,verifierVersion,scope,approvalId,approvedAt)
      VALUES('authority','w','app','app','hash','epoch','subject',1,'key','public-key','verifier','1','{}','approval','now');
    INSERT INTO ExecutionDelivery(id,attemptId,authorityId,receiverModuleId,receiverHash,receiverActivationId,launchDigest,launch)
      VALUES('delivery','attempt','authority','app','hash','epoch','launch-digest','{"state":"unknown"}');
    INSERT INTO ExecutionReceipt(id,deliveryId,operation,requestKey,requestDigest,receipt)
      VALUES('remote-receipt','delivery','start','fixed','digest','{"status":"unknown"}');
    INSERT INTO ExecutionDetail(attemptId,seq,event,bytes,expiresAt) VALUES('attempt',1,'{}',2,'2026-11-20');
    INSERT INTO ExecutionSnapshot(attemptId,snapshot,bytes,expiresAt) VALUES('attempt','{}',2,'2026-11-20');
    INSERT INTO ExecutionControl(attemptId,slot,fact,bytes) VALUES('attempt','cancel','{"pending":true}',16);
    INSERT INTO ExecutionCommand(attemptId,commandKey,operation,requestDigest,receipt)
      VALUES('attempt','fixed-command','cancel','command-digest','{"status":"unknown"}');`);
  const mind = privateDb(f.source, "mind-core.sqlite", `PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
    CREATE TABLE mind_meta(key TEXT PRIMARY KEY,data TEXT NOT NULL CHECK(json_valid(data)));
    INSERT INTO mind_meta VALUES('state','{"budget":17}');`);
  const journal = privateDb(f.source, "mind-execution.sqlite", "CREATE TABLE executions(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,json TEXT NOT NULL); INSERT INTO executions VALUES('same','now','{\"scope\":\"main\"}')");
  journal.close();
  for (const scope of ["admission", "verification"]) {
    privateDb(f.source, `${scope}/mind-execution.sqlite`, `CREATE TABLE executions(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,json TEXT NOT NULL);
      INSERT INTO executions VALUES('same','now','{"scope":"${scope}"}');
      CREATE TABLE ${scope}_requests(id TEXT PRIMARY KEY,json TEXT NOT NULL);
      INSERT INTO ${scope}_requests VALUES('pending','{"requestKey":"fixed"}')`).close();
  }
  for (const [file, definition] of Object.entries({
    "mind-delivery.sqlite": "CREATE TABLE delivery(id TEXT PRIMARY KEY,command_key TEXT UNIQUE NOT NULL,body TEXT NOT NULL)",
    "mind-delivery-admission.sqlite": "CREATE TABLE proofs(id TEXT PRIMARY KEY,json TEXT NOT NULL)",
    "mind-application.sqlite": "CREATE TABLE adapters(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE invocations(ref TEXT PRIMARY KEY,action_key TEXT UNIQUE NOT NULL,json TEXT NOT NULL)",
    "mind-artifacts.sqlite": "CREATE TABLE documents(ref TEXT PRIMARY KEY,action_key TEXT UNIQUE NOT NULL,input_digest TEXT NOT NULL,json TEXT NOT NULL); CREATE TABLE application_reads(ref TEXT PRIMARY KEY,pursuit_id TEXT NOT NULL,goal_digest TEXT)",
    "mind-notifications.sqlite": "CREATE TABLE notification_budget(day TEXT NOT NULL,key TEXT NOT NULL,level TEXT NOT NULL,PRIMARY KEY(day,key)); INSERT INTO notification_budget VALUES('2026-11-16','spent-key','urgent')",
  })) privateDb(f.source, file, definition).close();
  privateDb(f.source, "chat.sqlite", "PRAGMA journal_mode=WAL; CREATE TABLE messages(id TEXT PRIMARY KEY,body TEXT); INSERT INTO messages VALUES('m','untouched')").close();
  const conversations = join(appData, "conversations");
  mkdirSync(conversations, { mode: 0o700 });
  const originalSession = session();
  const journalPath = join(conversations, "state.json");
  writeFileSync(journalPath, JSON.stringify({ version: 1, sessions: [originalSession] }), { mode: 0o600 });
  mkdirSync(join(f.source, "sessions"), { mode: 0o700 });
  writeFileSync(join(f.source, "sessions/provider.jsonl"), '{"type":"provider-history"}\n', { mode: 0o600 });
  try {
    const before = readFileSync(join(f.source, "chrona.db"));
    const report = await migrateStorage(f.source, f.destination);
    expect(report.status).toBe("complete");
    expect(report.kernel.retiredCalendarSchedules).toBe(1);
    expect(report.kernel.retiredPreference).toBe(1);
    expect(readFileSync(join(f.source, "chrona.db"))).toEqual(before);
    expect(existsSync(join(f.source, "chrona.db.chrona.lock"))).toBe(false);
    expect(existsSync(join(f.destination, "original/chrona.db.tar"))).toBe(true);
    expect(existsSync(journalPath)).toBe(true);
    const convertedData = join(f.destination, "data"), convertedApp = join(convertedData, "platform/data/app");
    expect(statSync(join(f.destination, "data/chrona.db")).mode & 0o777).toBe(0o600);
    const db = new Database(join(convertedData, "chrona.db"), { readonly: true });
    try {
      expect(db.query("SELECT status,stopStatus,cwd FROM Run WHERE id='run'").get()).toEqual({ status: "unknown", stopStatus: "unknown", cwd: "/original/sessions/run" });
      expect(db.query("SELECT key,requestDigest,status,reply FROM ModuleInvocation").get()).toEqual({ key: "consumed-key", requestDigest: "digest", status: "unknown", reply: 1 });
      expect(db.query("SELECT id,timerId,status,payload FROM Timer").get()).toEqual({ id: "original-timer-id", timerId: "daily", status: "paused", payload: '{"message":"preserve"}' });
      expect(db.query("SELECT settings FROM Workspace").get()).toEqual({ settings: '{"custom":"preserve"}' });
      expect(db.query("SELECT output FROM ModuleInvocation").get()).toEqual({ output: '{"fixed":"receipt"}' });
      expect(db.query("SELECT receipt FROM ExecutionCommand").get()).toEqual({ receipt: '{"status":"unknown"}' });
      expect(db.query("SELECT status FROM Run WHERE id='queued-remote'").get()).toEqual({ status: "queued" });
      for (const table of ["ExecutionAttempt", "ExecutionAuthority", "ExecutionDelivery", "ExecutionReceipt", "ExecutionDetail", "ExecutionSnapshot", "ExecutionControl", "ExecutionCommand"]) {
        expect(report.kernel[table]).toBe(table === "ExecutionAttempt" ? 2 : 1);
      }
      expect(db.query("SELECT name FROM sqlite_master WHERE name IN ('Schedule','Preference')").all()).toEqual([]);
      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
    // Actual startup migration guard accepts the new checksum without an adoption bypass.
    ensureSqliteDatabase({ databaseUrl: `file:${join(convertedData, "chrona.db")}`, migrationsDir: resolve(import.meta.dir, "../../../prisma/migrations") });
    const combined = new Database(join(convertedApp, "mind.sqlite"), { readonly: true });
    try {
      expect(combined.query("SELECT data FROM mind_meta").get()).toEqual({ data: '{"budget":17}' });
      for (const scope of ["main", "admission", "verification"]) {
        expect(combined.query(`SELECT json FROM ${scope === "main" ? "executions" : `${scope}_executions`}`).get()).toEqual({ json: `{"scope":"${scope}"}` });
      }
      expect(combined.query("SELECT json FROM admission_requests").get()).toEqual({ json: '{"requestKey":"fixed"}' });
      expect(combined.query("SELECT key FROM notification_budget").get()).toEqual({ key: "spent-key" });
    } finally { combined.close(); }
    const call = async () => { throw Error("No external calls during migration validation"); };
    const app = createAgentConversations({ dataDir: convertedApp, call, reply: () => { throw Error("Unexpected reply"); } });
    expect((await app.list())[0]?.title).toBe("保留的对话");
    const entries = new Database(join(convertedApp, "conversations/sessions.sqlite"), { readonly: true });
    try { expect(JSON.parse((entries.query("SELECT data FROM conversations").get() as { data: string }).data)).toEqual(originalSession); }
    finally { entries.close(); }
    expect(existsSync(join(convertedApp, "mind-core.sqlite"))).toBe(false);
    expect(existsSync(join(convertedApp, "conversations/state.json"))).toBe(false);
    expect(readFileSync(join(convertedData, "sessions/provider.jsonl"), "utf8")).toBe('{"type":"provider-history"}\n');
  } finally { mind.close(); kernelWal.close(); }
});

test("unknown source checksum and invalid FK fail without publishing output", async () => {
  const f = fixture(), db = new Database(join(f.source, "chrona.db"));
  db.exec("UPDATE _chrona_migrations SET checksum='unrecognized'"); db.close();
  await assertFailure(f, "Unsupported source migration checksum");
  const other = fixture(), corrupt = new Database(join(other.source, "chrona.db"));
  corrupt.exec("PRAGMA foreign_keys=OFF; UPDATE Module SET workspaceId='missing'"); corrupt.close();
  await assertFailure(other, "foreign key");
});

test("open standing approval requires explicit resolution", async () => {
  const f = fixture(), db = new Database(join(f.source, "chrona.db"));
  db.exec(`INSERT INTO Approval(id,workspaceId,action,title,detail,preview,payload,scope)
    VALUES('standing','w','activate','title','detail','preview','{}','always')`);
  db.close();
  await assertFailure(f, "open standing approval");
});

test("duplicate timers fail, keeping keys and original schedules intact", async () => {
  const f = fixture(), db = new Database(join(f.source, "chrona.db"));
  db.exec(`INSERT INTO Schedule(id,workspaceId,moduleId,mode,text,rule,createdBy) VALUES('duplicate','w','app','timer','daily','{}','module')`);
  db.close();
  await assertFailure(f, "UNIQUE constraint failed");
});

test("mixed private storage and malformed sessions fail without silently starting an empty store", async () => {
  const f = fixture();
  privateDb(f.source, "mind-core.sqlite", "CREATE TABLE mind_meta(key TEXT PRIMARY KEY,data TEXT)").close();
  privateDb(f.source, "mind.sqlite", "CREATE TABLE mind_meta(key TEXT PRIMARY KEY,data TEXT)").close();
  await assertFailure(f, "Mixed legacy and new Mind");
  const other = fixture(), directory = join(other.source, "platform/data/entry/conversations");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(join(directory, "state.json"), JSON.stringify({ version: 1, sessions: [{ ...session(), turns: [{ pendingToolResults: [3] }] }] }), { mode: 0o600 });
  await assertFailure(other, "conversation journal is invalid");
});

test("refuses active service, nested destination, existing output and unowned legacy Run", async () => {
  const f = fixture(), lock = join(f.source, "chrona.db.chrona.lock");
  writeFileSync(lock, JSON.stringify({ version: 1, pid: process.pid, createdAt: new Date().toISOString() }), { mode: 0o600 });
  await assertFailure(f, "already in use");
  rmSync(lock);
  await expect(migrateStorage(f.source, join(f.source, "nested"))).rejects.toThrow("non-nested");
  mkdirSync(f.destination);
  await expect(migrateStorage(f.source, f.destination)).rejects.toThrow("already exists");
  rmSync(f.destination, { recursive: true });
  const db = new Database(join(f.source, "chrona.db"));
  db.exec("UPDATE Run SET status='queued'"); db.close();
  await assertFailure(f, "unfinished legacy Run");
});

for (const mode of ["absent", "reviewed", "blocked"] as const) {
  test(`Mind actual recovery reader preserves ${mode} generation and execution validity`, async () => {
    const f = fixture(), directory = join(f.source, "platform/data/mind");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const store = new CoreMindStore(directory), service = new CoreMindService(store);
    const marker = JSON.stringify({ version: 1, id: "original-generation", restoredAt: "2026-11-16T00:00:00Z" });
    if (mode !== "absent") writeFileSync(join(directory, ".chrona-restore.json"), marker, { mode: 0o600 });
    if (mode === "reviewed") writeFileSync(join(directory, ".mind-restore-review.json"), JSON.stringify({ id: "original-generation" }), { mode: 0o600 });
    const recovery = new CoreRecovery(directory, store, service);
    expect(recovery.status().blocked).toBe(mode === "blocked");
    const revision = store.read().visibilityRevision;
    const journal = new CoreExecutionJournal(directory);
    const prepared = journal.prepare({ purpose: "understand", subject: "batch:1", revision: 1, visibilityRevision: revision,
      prompt: "Preserve pending request", tools: [{ moduleId: "app", tool: "progress" }] }, "2026-11-16T00:00:00Z");
    journal.close(); store.close();
    // Split current-format fixture tables into the exact legacy filenames before converting.
    const split = new Database(join(directory, "mind.sqlite"));
    const entry = split.query<{ id: string; created_at: string; json: string }, []>("SELECT * FROM executions").get()!;
    split.exec("DROP TABLE executions"); split.close();
    renameSync(join(directory, "mind.sqlite"), join(directory, "mind-core.sqlite"));
    privateDb(f.source, "../mind/mind-execution.sqlite", "CREATE TABLE executions(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,json TEXT NOT NULL)").close();
    const legacyJournal = new Database(join(directory, "mind-execution.sqlite"));
    legacyJournal.query("INSERT INTO executions VALUES(?,?,?)").run(entry.id, entry.created_at, entry.json); legacyJournal.close();
    await migrateStorage(f.source, f.destination);
    const converted = join(f.destination, "data/platform/data/mind");
    expect(existsSync(join(converted, ".chrona-restore.json"))).toBe(mode !== "absent");
    if (mode !== "absent") expect(readFileSync(join(converted, ".chrona-restore.json"), "utf8")).toBe(marker);
    const actualStore = new CoreMindStore(converted), actualService = new CoreMindService(actualStore);
    const actualJournal = new CoreExecutionJournal(converted);
    try {
      const actualRecovery = new CoreRecovery(converted, actualStore, actualService);
      expect(actualRecovery.status().blocked).toBe(mode === "blocked");
      expect(actualStore.read().visibilityRevision).toBe(revision);
      actualJournal.scrubInvalid(e => e.visibilityRevision === actualStore.read().visibilityRevision);
      expect(actualJournal.outstanding()?.id).toBe(prepared.id);
      expect(actualJournal.outstanding()?.stopRequested).toBe(false);
      expect(actualJournal.outstanding()?.args.prompt).toBe("Preserve pending request");
    } finally { actualJournal.close(); actualStore.close(); }
  });
}
