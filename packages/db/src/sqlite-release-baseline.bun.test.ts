import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checksumSql, ensureSqliteDatabase, schemaFingerprint, verifyMigrationReleaseMetadata } from "./sqlite-migrations";
import { createDevelopmentFixture, developmentChecksums, publishedRepairMigration, releaseMigrationsDir as migrationsDir } from "./sqlite-development-fixture.test-support";
import { normalizeLegacyMigrationHistory } from "./sqlite-migration-history-normalizers";

const metadata = verifyMigrationReleaseMetadata(migrationsDir)!;
const publishedChecksum = "641aa4b5907177ca6857c659a3ddb8fa8b7ed3d14c975f026ba250296e36675e";
const stages = ["released", "management", "manual", "current"] as const;

function withRoot(test: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "chrona-release-baseline-test-"));
  try { test(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function history(db: Database) {
  return db.query("SELECT migration_name, checksum, applied_steps_count FROM _prisma_migrations ORDER BY migration_name").all();
}

function snapshot(db: Database) {
  const tables = ["Workspace", "Task", "Goal", "TaskPlan", "TaskPlanRun", "Run", "Artifact", "Event", "GoalAsset", "GoalAssetVersion", "ManagementClient", "ManagementCommand"];
  return Object.fromEntries(tables.filter((table) => db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)).map((table) => {
    const columns = (db.query(`PRAGMA table_info('${table}')`).all() as { name: string }[])
      .filter(({ name }) => name !== "configRevision" && name !== "taskExecutionMode")
      .map(({ name }) => `"${name}"`).join(",");
    return [table, db.query(`SELECT ${columns} FROM "${table}" ORDER BY id`).all()];
  }));
}

function seed(db: Database) {
  db.run(`
    PRAGMA foreign_keys = ON;
    INSERT INTO Workspace (id,name,status,updatedAt) VALUES ('workspace','Preserve','Active',CURRENT_TIMESTAMP);
    INSERT INTO Goal (id,workspaceId,title,successCriteria,status,updatedAt) VALUES ('goal','workspace','Preserve goal','[]','Paused',CURRENT_TIMESTAMP);
    INSERT INTO Task (id,workspaceId,goalId,title,executionConfig,status,priority,latestRunId,updatedAt) VALUES ('task','workspace','goal','Preserve task','{}','Done','High','run',CURRENT_TIMESTAMP);
    INSERT INTO Run (id,taskId,runtimeName,status,triggeredBy,updatedAt) VALUES ('run','task','debug','Completed','manual',CURRENT_TIMESTAMP);
    INSERT INTO Artifact (id,workspaceId,taskId,runId,type,title,uri) VALUES ('artifact','workspace','task','run','file','Preserve artifact','generated://result/report.txt');
    INSERT INTO TaskPlan (id,workspaceId,taskId,planId,revision,status,compiledPlan,updatedAt) VALUES ('plan-row','workspace','task','plan',1,'Accepted','{}',CURRENT_TIMESTAMP);
    INSERT INTO TaskPlanRun (id,executionScopeId,workspaceId,taskId,planId,planRun,updatedAt) VALUES ('plan-run','scope','workspace','task','plan','{"status":"Completed","planOutput":{"findings":[{"key":"finding","content":"Preserve finding"}]}}',CURRENT_TIMESTAMP);
    INSERT INTO Event (id,eventType,workspaceId,taskId,runId,actorType,source,payload,ingestSequence) VALUES ('accepted','task.result.accepted','workspace','task','run','user','web','{"runId":"run","accepted_run_id":"run"}',1);
    INSERT INTO GoalAsset (id,workspaceId,goalId,sourceArtifactId,currentArtifactId,role,status,label,updatedAt) VALUES ('asset','workspace','goal','artifact','artifact','reference','Active','Preserve asset',CURRENT_TIMESTAMP);
    INSERT INTO GoalAssetVersion (id,workspaceId,goalId,assetId,artifactId,version,source,content,contentHash,sourceTaskId,sourceRunId,authorType) VALUES ('version','workspace','goal','asset','artifact',1,'task_result','{"text":"Preserve accepted content"}','fixture-content-hash','task','run','user');
  `);
  if (db.query("SELECT name FROM sqlite_master WHERE name = 'ManagementClient'").get()) {
    // Synthetic database rows only: no credential issuance or command execution.
    db.query("INSERT INTO ManagementClient (id,workspaceId,name,tokenDigest,scopes,publicUrl,updatedAt) VALUES ('client','workspace','Fixture',?,'[]','https://example.invalid',CURRENT_TIMESTAMP)").run(checksumSql("synthetic fixture, not a credential"));
    db.run("INSERT INTO ManagementCommand (id,clientId,workspaceId,toolName,requestId,payloadHash,input,taskId,state,result,updatedAt) VALUES ('command','client','workspace','fixture','request','fixture-hash','{}','task','completed','{}',CURRENT_TIMESTAMP)");
  }
  if (db.query("SELECT name FROM pragma_table_info('Task') WHERE name = 'taskExecutionMode'").get()) {
    db.run("UPDATE Task SET taskExecutionMode = 'manual' WHERE id = 'task'");
  }
  expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
}

describe("published v0.3.1 migration baseline", () => {
  it("pins the verified archive, fixture and every shipped SQL resource", () => {
    expect(metadata.lastReleasedVersion).toBe("0.3.1");
    expect(metadata.releasedMigrationChecksums[publishedRepairMigration]).toBe(publishedChecksum);
    expect(metadata.mutableReleaseLineMigration).toBe("20260917000000_add_work_management");
    expect(metadata.mutableReleaseLineAmendments?.[publishedChecksum]).toBeUndefined();
    expect(metadata.mutableReleaseLineAmendments?.["6a64640078ea9a40442dba985f373087b06b1ab229b345de4fe9533f9d59cfb3"]).toMatchObject({ fromSchemaFingerprint: "41bb15e4b06797f37c0d59ee08998d41353ac9f4404cd75777b8f5993bf7e37d" });
    expect(metadata.legacyHistoryNormalizations?.[publishedChecksum]).toBeUndefined();
    const provenance = JSON.parse(readFileSync(join(migrationsDir, metadata.previousReleaseFixture.provenancePath), "utf8")) as {
      releaseTag: string; releaseAsset: { sha256: string }; resources: { path: string; sha256: string }[];
    };
    expect(provenance.releaseTag).toBe("v0.3.1");
    expect(provenance.releaseAsset.sha256).toBe("04ebf9c781929d868a39de08db2f783229374fccbdce0e2e20a90f4076084fb0");
    for (const resource of provenance.resources.filter((r) => r.path.endsWith(".sql"))) {
      expect(checksumSql(readFileSync(join(migrationsDir, "../..", resource.path)))).toBe(resource.sha256);
    }
  });

  for (const stage of stages) {
    it(`upgrades ${stage}, preserves results/acceptance/assets and leaves an exact pre-upgrade backup`, () => withRoot((root) => {
      const path = join(root, "chrona.db");
      if (stage === "released") cpSync(join(migrationsDir, metadata.previousReleaseFixture.path), path);
      else createDevelopmentFixture(path, stage);
      const prior = new Database(path);
      seed(prior);
      const before = snapshot(prior);
      const beforeHistory = history(prior);
      const sourceFingerprint = schemaFingerprint(prior);
      prior.close();
      const receipt = ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir });
      expect(receipt.preUpgradeBackup).toBeTruthy();
      const backup = new Database(receipt.preUpgradeBackup!.backupPath, { readonly: true });
      try {
        expect(history(backup)).toEqual(beforeHistory);
        expect(snapshot(backup)).toEqual(before);
        expect(schemaFingerprint(backup)).toBe(sourceFingerprint);
      } finally { backup.close(); }
      const db = new Database(path, { readonly: true });
      let upgradedHistory: ReturnType<typeof history>;
      try {
        expect(snapshot(db)).toEqual({ ManagementClient: [], ManagementCommand: [], ...before,
          Artifact: (before.Artifact as object[]).map((artifact) => ({ ...artifact, ownerKind: "run", resultId: null })),
        });
        expect(schemaFingerprint(db)).toBe(metadata.releaseLineSchemaFingerprint);
        expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
        expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(db.query("SELECT checksum FROM _prisma_migrations WHERE migration_name = ?").get(publishedRepairMigration)).toEqual({ checksum: publishedChecksum });
        expect(db.query("SELECT taskExecutionMode FROM Task").get()).toEqual({ taskExecutionMode: stage === "manual" || stage === "current" ? "manual" : "ai" });
        upgradedHistory = history(db);
        expect(upgradedHistory).toHaveLength(4);
      } finally { db.close(); }
      expect(ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir }).preUpgradeBackup).toBeNull();
      const reopened = new Database(path, { readonly: true });
      try { expect(history(reopened)).toEqual(upgradedHistory); } finally { reopened.close(); }
    }));
  }

  for (const stage of Object.keys(developmentChecksums) as (keyof typeof developmentChecksums)[]) {
    for (const fault of ["schema", "steps", "extra-history"] as const) {
      it(`rejects ${stage} development ${fault} drift without rewriting history or schema`, () => withRoot((root) => {
        const path = join(root, "chrona.db");
        createDevelopmentFixture(path, stage);
        const prior = new Database(path);
        if (fault === "schema") prior.run("CREATE TABLE Unexpected (id TEXT)");
        if (fault === "steps") prior.run("UPDATE _prisma_migrations SET applied_steps_count = 2 WHERE migration_name = ?", [publishedRepairMigration]);
        if (fault === "extra-history") prior.run("INSERT INTO _prisma_migrations (id,checksum,migration_name,finished_at,applied_steps_count) VALUES ('unknown',?,'20990101000000_unknown',CURRENT_TIMESTAMP,1)", [checksumSql("unknown")]);
        const beforeHistory = history(prior);
        const beforeSchema = schemaFingerprint(prior);
        prior.close();
        expect(() => ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir })).toThrow(fault === "schema" ? "registered source" : "Unrecognized migration history");
        const after = new Database(path, { readonly: true });
        try {
          expect(history(after)).toEqual(beforeHistory);
          expect(schemaFingerprint(after)).toBe(beforeSchema);
        } finally { after.close(); }
      }));
    }
  }

  it("rolls back normalization SQL and history together when target verification fails", () => withRoot((root) => {
    const path = join(root, "chrona.db");
    createDevelopmentFixture(path, "management");
    const db = new Database(path);
    try {
      const beforeHistory = history(db);
      const beforeSchema = schemaFingerprint(db);
      expect(() => normalizeLegacyMigrationHistory({
        db, migrationsDir, mutableChecksum: checksumSql(readFileSync(join(migrationsDir, metadata.mutableReleaseLineMigration, "migration.sql"))),
        metadata: { ...metadata, releaseLineSchemaFingerprint: "0".repeat(64) },
      })).toThrow("resulting schema fingerprint");
      expect(history(db)).toEqual(beforeHistory);
      expect(schemaFingerprint(db)).toBe(beforeSchema);
      expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    } finally { db.close(); }
  }));

  it("rejects schema drift even after all current migrations have been recorded", () => withRoot((root) => {
    const path = join(root, "chrona.db");
    ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir });
    const db = new Database(path);
    db.run("CREATE TABLE Unexpected (id TEXT)");
    db.close();
    expect(() => ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir })).toThrow("current database schema fingerprint does not match");
  }));

  it("rejects changed published SQL before opening a database", () => withRoot((root) => {
    const copy = join(root, "migrations");
    cpSync(migrationsDir, copy, { recursive: true });
    writeFileSync(join(copy, publishedRepairMigration, "migration.sql"), "-- replaced published SQL\n");
    expect(() => verifyMigrationReleaseMetadata(copy)).toThrow("checksum");
  }));
});
