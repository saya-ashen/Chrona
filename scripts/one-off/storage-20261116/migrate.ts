/** One-time offline conversion. Deliberately absent from CLI and release resources. */
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { backupSqliteDatabase, restoreSqliteDatabase } from "../../../packages/db/src/sqlite-backup";
import { replaceDataFiles, stageDataFiles } from "../../../packages/db/src/sqlite-backup-files";
import { checksumSql, ensureSqliteDatabase } from "../../../packages/db/src/sqlite-migrations";
import { createAgentConversations } from "../../../packages/engine/src/modules/steward/entry-app/conversations";

const SOURCE_CHECKSUM = "6d83f856c64179ca02a18a3865c5eb2b458038a737cf70bcf43e5b01e44ff550";
const TARGET_CHECKSUM = "b254c9a12912dcf6e53d6588e0edc3b79c25cafa4f15a9755aac00e3276aa458";
const MIGRATIONS = resolve(import.meta.dir, "../../../prisma/migrations");
const RETIRED_TABLES = ["Message", "Preference", "Grant", "BuildTargets", "BuildRequest"];
const RETIRED_COLUMNS: Record<string, string[]> = {
  ModuleVersion: ["buildSessionId"], Approval: ["scope", "grantId"],
  StewardState: ["leaseUntil", "leaseToken", "providerName", "providerAvailable", "providerSandboxed", "providerLastError"],
};
const MIND_FILES = ["mind-core.sqlite", "mind-execution.sqlite", "mind-delivery.sqlite", "mind-delivery-admission.sqlite",
  "mind-application.sqlite", "mind-artifacts.sqlite", "mind-notifications.sqlite", "admission/mind-execution.sqlite", "verification/mind-execution.sqlite"];
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const url = (path: string) => `file:${path}`;
const within = (path: string, parent: string) => path === parent || path.startsWith(`${parent}${sep}`);
const tables = (db: Database, schema = "main") => db.query<{ name: string }, []>(
  `SELECT name FROM ${schema}.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
).all().map(row => row.name);
const columns = (db: Database, table: string, schema = "main") => db.query<{ name: string }, []>(
  `PRAGMA ${schema}.table_info(${quote(table)})`,
).all().map(row => row.name);
const count = (db: Database, table: string, schema = "main") => Number(db.query<{ n: number }, []>(
  `SELECT count(*) AS n FROM ${schema}.${quote(table)}`,
).get()!.n);
function check(db: Database) {
  const integrity = db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok" || db.query("PRAGMA foreign_key_check").all().length) {
    throw Error("Converted database failed integrity or foreign key checks");
  }
}
function equalRows(db: Database, target: string, source: string, names: string[], where = "") {
  const fields = names.map(quote).join(",");
  const left = `SELECT ${fields} FROM main.${quote(target)}`;
  const right = `SELECT ${fields} FROM legacy.${quote(source)} ${where}`;
  if (db.query(`SELECT 1 FROM (${left} EXCEPT ${right}) LIMIT 1`).get()
    || db.query(`SELECT 1 FROM (${right} EXCEPT ${left}) LIMIT 1`).get()) throw Error(`Row verification failed: ${target}`);
}
function convertKernel(source: string, destination: string) {
  ensureSqliteDatabase({ databaseUrl: url(destination), migrationsDir: MIGRATIONS });
  const db = new Database(destination);
  const report: Record<string, number> = {};
  try {
    db.run("ATTACH DATABASE ? AS legacy", [source]);
    const history = db.query<{ name: string; checksum: string }, []>("SELECT name, checksum FROM legacy._chrona_migrations ORDER BY name").all();
    if (history.length !== 1 || history[0]?.name !== "0001_initial" || history[0].checksum !== SOURCE_CHECKSUM) {
      throw Error("Unsupported source migration checksum; only the pre-storage-simplification baseline is accepted");
    }
    const targetTables = tables(db).filter(name => name !== "_chrona_migrations");
    const expected = [...targetTables.filter(name => name !== "Timer"), "Schedule", ...RETIRED_TABLES, "_chrona_migrations"].sort();
    if (JSON.stringify(tables(db, "legacy")) !== JSON.stringify(expected)) throw Error("Unexpected source tables");
    if (db.query("SELECT 1 FROM legacy.Approval WHERE status='open' AND scope<>'once' LIMIT 1").get()) {
      throw Error("An open standing approval needs explicit resolution before conversion");
    }
    if (db.query(`SELECT 1 FROM legacy.Run r LEFT JOIN legacy.AgentContext a ON a.sessionId=r.sessionId
      WHERE r.status IN ('queued','running') AND a.sessionId IS NULL
      AND NOT EXISTS (SELECT 1 FROM legacy.ExecutionAttempt e WHERE e.runId=r.id) LIMIT 1`).get()) {
      throw Error("An unfinished legacy Run has no application Agent context; resolve it before conversion");
    }
    // Import arbitrary FK order as one unit; validate all references before commit.
    db.exec("PRAGMA foreign_keys=OFF");
    db.transaction(() => {
      for (const table of targetTables.filter(name => name !== "Timer")) {
        const names = columns(db, table);
        const expectedColumns = [...names, ...(RETIRED_COLUMNS[table] ?? [])].sort();
        if (JSON.stringify(columns(db, table, "legacy").sort()) !== JSON.stringify(expectedColumns)) {
          throw Error(`Unexpected source columns: ${table}`);
        }
        const fields = names.map(quote).join(",");
        db.exec(`INSERT INTO main.${quote(table)} (${fields}) SELECT ${fields} FROM legacy.${quote(table)}`);
        equalRows(db, table, table, names);
        report[table] = count(db, table);
        if (report[table] !== count(db, table, "legacy")) throw Error(`Row count mismatch: ${table}`);
      }
      if (db.query("SELECT 1 FROM legacy.Schedule WHERE mode='timer' AND (moduleId IS NULL OR text='') LIMIT 1").get()) {
        throw Error("An application timer is missing its owner or timer ID");
      }
      const names = columns(db, "Timer"), sourceNames = names.map(name => name === "timerId" ? "text" : name);
      db.exec(`INSERT INTO Timer (${names.map(quote).join(",")}) SELECT ${sourceNames.map(quote).join(",")}
        FROM legacy.Schedule WHERE mode='timer'`);
      // Keep original primary IDs, rule revisions and times so pending timer receipts still refer to the same timer.
      const timerDiff = db.query(`SELECT 1 FROM (SELECT ${sourceNames.map(quote).join(",")} FROM legacy.Schedule WHERE mode='timer'
        EXCEPT SELECT ${names.map(quote).join(",")} FROM Timer) LIMIT 1`).get();
      const expectedTimers = db.query<{ n: number }, []>("SELECT count(*) AS n FROM legacy.Schedule WHERE mode='timer'").get()!.n;
      if (timerDiff || count(db, "Timer") !== expectedTimers) throw Error("Timer verification failed");
      report.Timer = count(db, "Timer");
      report.retiredCalendarSchedules = count(db, "Schedule", "legacy") - report.Timer;
      for (const table of RETIRED_TABLES) report[`retired${table}`] = count(db, table, "legacy");
      check(db);
    }).immediate();
    db.exec("PRAGMA foreign_keys=ON");
    check(db);
  } finally { db.close(); }
  return report;
}
function convertMind(directory: string) {
  const present = MIND_FILES.filter(file => existsSync(join(directory, file)));
  if (!present.length) return null;
  const destination = join(directory, "mind.sqlite");
  if (existsSync(destination)) throw Error("Mixed legacy and new Mind storage; refusing to guess which copy is current");
  const db = new Database(destination, { create: true });
  chmodSync(destination, 0o600);
  const report: Record<string, number> = {};
  try {
    for (const file of present) {
      db.run("ATTACH DATABASE ? AS legacy", [join(directory, file)]);
      try {
        db.transaction(() => {
          const definitions = db.query<{ name: string; sql: string }, []>(
            "SELECT name, sql FROM legacy.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          ).all();
          for (const { name, sql } of definitions) {
            const target = name === "executions" && file.startsWith("admission/") ? "admission_executions"
              : name === "executions" && file.startsWith("verification/") ? "verification_executions" : name;
            const definition = sql.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)/i,
              `CREATE TABLE ${quote(target)}`);
            db.exec(definition);
            db.exec(`INSERT INTO ${quote(target)} SELECT * FROM legacy.${quote(name)}`);
            equalRows(db, target, name, columns(db, target));
            report[target] = count(db, target);
            if (report[target] !== count(db, name, "legacy")) throw Error(`Mind row count mismatch: ${target}`);
          }
          for (const index of db.query<{ sql: string }, []>("SELECT sql FROM legacy.sqlite_master WHERE type='index' AND sql IS NOT NULL").all()) {
            db.exec(index.sql);
          }
          if (db.query("SELECT 1 FROM legacy.sqlite_master WHERE type IN ('trigger','view') LIMIT 1").get()) {
            throw Error("Unexpected legacy Mind trigger/view; conversion needs review");
          }
          check(db);
        }).immediate();
      } finally { db.exec("DETACH DATABASE legacy"); }
    }
    check(db);
  } finally { db.close(); }
  // Only staged copies are removed. Original files remain in the source and backup archive.
  for (const file of present) rmSync(join(directory, file));
  return report;
}
async function convertConversations(directory: string) {
  const path = join(directory, "conversations", "state.json");
  if (!existsSync(path)) return null;
  const destination = join(dirname(path), "sessions.sqlite");
  if (existsSync(destination)) throw Error("Mixed legacy and new entry conversation storage");
  const state = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown; sessions?: ({ id?: unknown } | null)[] } | null;
  if (state?.version !== 1 || !Array.isArray(state.sessions)) throw Error("Invalid legacy conversation journal");
  const sessions = state.sessions;
  const db = new Database(destination, { create: true });
  chmodSync(destination, 0o600);
  try {
    db.exec("CREATE TABLE conversations(id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)))");
    db.transaction(() => {
      for (const session of sessions) {
        if (!session || typeof session.id !== "string") throw Error("Invalid conversation identity");
        const data = JSON.stringify(session);
        db.query("INSERT INTO conversations(id,data) VALUES(?,?)").run(session.id, data);
        const row = db.query<{ data: string }, [string]>("SELECT data FROM conversations WHERE id=?").get(session.id);
        if (row?.data !== data) throw Error("Conversation row verification failed");
      }
      check(db);
    }).immediate();
  } finally { db.close(); }
  // Use the actual application reader to validate turns, receipts and memory without dispatching anything.
  const forbiddenCall = async () => { throw Error("Migration must not dispatch application tools"); };
  const reader = createAgentConversations({ dataDir: directory, call: forbiddenCall, reply: () => { throw Error("Unexpected reply during migration"); } });
  for (const session of await reader.list()) await reader.session(session.id);
  rmSync(path);
  return sessions.length;
}
export async function migrateStorage(sourceDir: string, destinationDir: string) {
  const source = realpathSync(sourceDir);
  // Resolve the existing parent as well, so a symlink cannot hide a destination inside the source.
  const destination = join(realpathSync(dirname(resolve(destinationDir))), resolve(destinationDir).split(sep).at(-1)!);
  if (within(destination, source) || within(source, destination)) throw Error("Source and destination must be separate, non-nested directories");
  if (existsSync(destination)) throw Error("Destination already exists; it will never be overwritten");
  const migration = readFileSync(join(MIGRATIONS, "0001_initial/migration.sql"), "utf8");
  if (checksumSql(migration) !== TARGET_CHECKSUM) throw Error("Target schema changed; this one-time converter must be reviewed");
  const stage = mkdtempSync(`${destination}.converting-`);
  chmodSync(stage, 0o700);
  const report = { version: 1, source, destination, sourceChecksum: SOURCE_CHECKSUM, targetChecksum: TARGET_CHECKSUM,
    status: "converting", omitted: [] as string[], kernel: {} as Record<string, number>,
    mind: {} as Record<string, Record<string, number>>, conversations: {} as Record<string, number> };
  const reportPath = join(stage, "migration-report.json");
  try {
    mkdirSync(join(stage, "original"), { mode: 0o700 });
    mkdirSync(join(stage, "data"), { mode: 0o700 });
    const snapshot = join(stage, "original/chrona.db");
    report.omitted = backupSqliteDatabase(url(join(source, "chrona.db")), snapshot, source).omitted;
    const legacy = join(stage, "data/chrona.db");
    // Format conversion preserves restore generations; the full restore entry deliberately creates a new one.
    const files = stageDataFiles(join(stage, "data"), `${snapshot}.tar`);
    replaceDataFiles(join(stage, "data"), files, () => restoreSqliteDatabase(url(legacy), snapshot));
    const target = join(stage, "data/chrona.new.db");
    report.kernel = convertKernel(legacy, target);
    rmSync(legacy);
    renameSync(target, legacy);
    const privateRoot = join(stage, "data/platform/data");
    if (existsSync(privateRoot)) {
      for (const entry of readdirSync(privateRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const directory = join(privateRoot, entry.name);
        const mind = convertMind(directory);
        if (mind) report.mind[entry.name] = mind;
        const sessions = await convertConversations(directory);
        if (sessions !== null) report.conversations[entry.name] = sessions;
      }
    }
    report.status = "complete";
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    renameSync(stage, destination);
    return report;
  } catch (error) {
    report.status = "failed";
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    throw new Error(`Conversion failed; source preserved, partial output retained at ${stage}`, { cause: error });
  }
}
if (import.meta.main) {
  const { values } = parseArgs({ options: { source: { type: "string" }, destination: { type: "string" }, help: { type: "boolean" } } });
  if (values.help) console.log("bun scripts/one-off/storage-20261116/migrate.ts --source <stopped-data-dir> --destination <new-output-dir>");
  else if (!values.source || !values.destination) throw Error("Both --source and --destination are required; stop Chrona and application processes first");
  else {
    const result = await migrateStorage(values.source, values.destination);
    console.log(JSON.stringify({ event: "storage_conversion_complete", destination: result.destination, report: join(result.destination, "migration-report.json") }));
  }
}
