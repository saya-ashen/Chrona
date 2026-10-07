import { Database } from "bun:sqlite";
import { expect, it } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checksumSql, ensureSqliteDatabase, schemaFingerprint, verifyMigrationReleaseMetadata } from "./sqlite-migrations";

const migrationsDir = resolve(import.meta.dir, "../../../prisma/migrations");
const fixture = join(migrationsDir, "fixtures/pre-result-files.sqlite");
const metadata = verifyMigrationReleaseMetadata(migrationsDir)!;
it("rebuilds Artifact from the exact B1 checksum without changing legacy result/Goal references, AF identity or acceptance", () => {
  const root = mkdtempSync(join(tmpdir(), "chrona-result-files-migration-")), path = join(root, "test.sqlite");
  cpSync(fixture, path);
  expect(checksumSql(readFileSync(fixture))).toBe("c90910aea9bb96470056dad46c814b97ca665e5967ae68d52dee589f020a0091");
  const before = new Database(path);
  try {
    before.run(`PRAGMA foreign_keys=ON;
      INSERT INTO Workspace (id,name,status,updatedAt) VALUES ('w','Workspace','Active',CURRENT_TIMESTAMP);
      INSERT INTO Goal (id,workspaceId,title,successCriteria,updatedAt) VALUES ('g','w','Goal','[]',CURRENT_TIMESTAMP);
      INSERT INTO Task (id,workspaceId,goalId,title,executionConfig,status,priority,updatedAt) VALUES ('t','w','g','Task','{}','Completed','Medium',CURRENT_TIMESTAMP);
      INSERT INTO Run (id,taskId,runtimeName,status,triggeredBy,updatedAt) VALUES ('run','t','debug','Completed','manual',CURRENT_TIMESTAMP);
      INSERT INTO Artifact (id,workspaceId,taskId,runId,type,title,uri,metadata) VALUES ('af-old','w','t','run','file','Old file','generated://fixture/old.txt','{"retained":true}');
      INSERT INTO GoalAsset (id,workspaceId,goalId,sourceArtifactId,currentArtifactId,role,status,label,updatedAt) VALUES ('ga','w','g','af-old','af-old','primary','active','Old asset',CURRENT_TIMESTAMP);
      INSERT INTO GoalAssetVersion (id,workspaceId,goalId,assetId,artifactId,version,source,content,contentHash,authorType) VALUES ('gav','w','g','ga','af-old',1,'task_result','{}','hash','user');
      INSERT INTO TaskResult (id,workspaceId,taskId,scopeKey,updatedAt) VALUES ('r','w','t','task',CURRENT_TIMESTAMP);
      INSERT INTO TaskResultVersion (id,resultId,version,content,contentHash,sourceKind,actorKey) VALUES ('v','r',1,'{}','${"0".repeat(64)}','human','human:owner');
      INSERT INTO ResultVersionArtifact (versionId,artifactId,artifactRef,artifactFingerprint,key,role,required) VALUES ('v','af-old','AF0123456789AB','${"1".repeat(64)}','old','deliverable',1);
      UPDATE TaskResult SET headVersionId='v',editRevision=1 WHERE id='r';
      INSERT INTO ResultCommand (id,workspaceId,actorKey,operation,requestId,payloadHash,resultId,versionId,receipt) VALUES ('cmd','w','human:owner','review','request','${"0".repeat(64)}','r','v','{}');
      INSERT INTO TaskResultReview (id,resultId,versionId,commandId,revision,decision,actorKey) VALUES ('review','r','v','cmd',2,'accept','human:owner');
      UPDATE TaskResult SET acceptedVersionId='v',editRevision=2 WHERE id='r';`);
    const tables = ["Task", "Run", "Goal", "GoalAsset", "GoalAssetVersion", "TaskResult", "TaskResultVersion", "TaskResultReview", "ResultCommand", "ResultVersionArtifact"];
    const oldColumns = tables.map((table) => (before.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((col) => `"${col.name}"`).join(","));
    const snapshots = tables.map((table) => before.query(`SELECT * FROM ${table}`).all());
    const artifact = before.query("SELECT * FROM Artifact").get(); before.close();
    const upgraded = ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir });
    expect(upgraded.preUpgradeBackup).toBeTruthy();
    const after = new Database(path);
    try {
      expect(schemaFingerprint(after)).toBe(metadata.releaseLineSchemaFingerprint);
      expect(tables.map((table, i) => after.query(`SELECT ${oldColumns[i]} FROM ${table}`).all())).toEqual(snapshots);
      expect(after.query("SELECT inputRevision FROM TaskResult").all()).toEqual([{ inputRevision: 0 }]);
      expect(after.query("SELECT * FROM Artifact").get()).toEqual({ ...artifact as object, ownerKind: "run", resultId: null });
      expect(after.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(after.query("SELECT count(*) AS n FROM ResultArtifactBytes").get()).toEqual({ n: 0 });
      after.run("PRAGMA foreign_keys=ON");
      expect(() => after.run("DELETE FROM Artifact WHERE id='af-old'")).toThrow();
      expect(() => after.run("UPDATE Artifact SET ownerKind='result',runId=NULL,resultId='r' WHERE id='af-old'")).toThrow();
    } finally { after.close(); }
    expect(ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir }).preUpgradeBackup).toBeNull();
    const backup = new Database(upgraded.preUpgradeBackup!.backupPath, { readonly: true });
    try { expect(backup.query("SELECT * FROM Artifact").get()).toEqual(artifact); } finally { backup.close(); }
  } finally { before.close(); rmSync(root, { recursive: true, force: true }); }
});
