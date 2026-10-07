import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { checksumSql, ensureSqliteDatabase, schemaFingerprint, verifyMigrationReleaseMetadata } from "./sqlite-migrations";

function seedExistingWork(db: Database) {
  db.exec(`PRAGMA foreign_keys=ON;
    INSERT INTO Workspace (id,name,status,updatedAt) VALUES ('w','Keep','Active',CURRENT_TIMESTAMP);
    INSERT INTO Task (id,workspaceId,title,status,priority,executionConfig,taskExecutionMode,autoPlanGeneration,autoExecute,updatedAt) VALUES ('t','w','Keep task','Ready','Medium','{}','manual',0,0,CURRENT_TIMESTAMP);
    INSERT INTO WorkRecord (taskId,workspaceId,context,signals,lastActorKey,updatedAt) VALUES ('t','w','{"kind":"general"}','{}','owner:local',CURRENT_TIMESTAMP);
    INSERT INTO WorkSource (id,taskId,workspaceId,sourceKey,data,actorKey) VALUES ('source','t','w','stable-source','{"kind":"reference"}','owner:local');
    INSERT INTO WorkEntry (id,taskId,kind,actorKey,summary,details) VALUES ('entry','t','report','owner:local','Keep report','{}');
    INSERT INTO TaskResult (id,workspaceId,taskId,scopeKey,updatedAt) VALUES ('r','w','t','task',CURRENT_TIMESTAMP);
    INSERT INTO TaskResultVersion (id,resultId,version,content,contentHash,sourceKind,actorKey) VALUES ('v','r',1,'{}','${"0".repeat(64)}','external','external:fixture');
    INSERT INTO Artifact (id,workspaceId,taskId,ownerKind,resultId,type,title,uri) VALUES ('af','w','t','result','r','file','Keep file','result-file://af');
    INSERT INTO ResultArtifactBytes (artifactId,sizeBytes,sha256,filename,mimeType,data) VALUES ('af',3,'${checksumSql(Buffer.from("abc"))}','keep.txt','text/plain',X'616263');
    INSERT INTO ResultVersionArtifact (id,versionId,artifactId,artifactRef,artifactFingerprint,key,role,required) VALUES ('link','v','af','AF0123456789AB','${"1".repeat(64)}','keep','deliverable',1);
    UPDATE TaskResult SET headVersionId='v',editRevision=1 WHERE id='r';
    INSERT INTO ResultCommand (id,workspaceId,actorKey,operation,requestId,payloadHash,resultId,versionId,receipt) VALUES ('cmd','w','human:owner','review','request','${"0".repeat(64)}','r','v','{}');
    INSERT INTO TaskResultReview (id,resultId,versionId,commandId,revision,decision,actorKey) VALUES ('review','r','v','cmd',2,'accept','human:owner');
    UPDATE TaskResult SET acceptedVersionId='v',editRevision=2 WHERE id='r';`);
}
function snapshots(db: Database) {
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name").all() as { name: string }[];
  return tables.map(({ name }) => ({ name, columns: (db.query(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map((col) => `"${col.name}"`).join(","), rows: db.query(`SELECT * FROM "${name}"`).all() }));
}
test("known pre-page database upgrades additively, preserving result acceptance, file bytes, sources and all prior columns", () => {
  const dir = mkdtempSync(join(tmpdir(), "chrona-page-upgrade-")), path = join(dir, "upgrade.sqlite"), fresh = join(dir, "fresh.sqlite");
  const migrationsDir = resolve(import.meta.dir, "../../../prisma/migrations"), fixture = join(migrationsDir, "fixtures/pre-work-pages.sqlite");
  try {
    expect(checksumSql(readFileSync(fixture))).toBe("e1a3e7af86afba30dca1622ab54ab5c366139b0eb25e1bd9319457ec40c65928");
    cpSync(fixture, path);
    const before = new Database(path);
    let original: ReturnType<typeof snapshots>, old: string;
    try { seedExistingWork(before); original = snapshots(before); old = schemaFingerprint(before); } finally { before.close(); }
    const metadata = verifyMigrationReleaseMetadata(migrationsDir)!;
    expect(Object.values(metadata.mutableReleaseLineAmendments ?? {}).some((a) => a.fromSchemaFingerprint === old)).toBe(true);
    expect(ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir }).preUpgradeBackup).toBeTruthy();
    expect(ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir }).preUpgradeBackup).toBeNull();
    ensureSqliteDatabase({ databaseUrl: `file:${fresh}`, migrationsDir });
    const upgraded = new Database(path), installed = new Database(fresh);
    try {
      for (const table of original) expect(upgraded.query(`SELECT ${table.columns} FROM "${table.name}"`).all()).toEqual(table.rows);
      expect(upgraded.query('SELECT "id", "inputRevision" FROM "TaskResult"').all()).toEqual([{ id: "r", inputRevision: 0 }]);
      expect(schemaFingerprint(upgraded)).toBe(schemaFingerprint(installed));
      expect(schemaFingerprint(upgraded)).toBe(metadata.releaseLineSchemaFingerprint);
      expect(upgraded.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(upgraded.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      upgraded.exec("PRAGMA foreign_keys=ON");
      expect(() => upgraded.exec("UPDATE TaskResultVersion SET content='{}' WHERE id='v'")).toThrow();
      expect(() => upgraded.exec("UPDATE ResultArtifactBytes SET data=X'616263' WHERE artifactId='af'")).toThrow();
      expect(() => upgraded.exec("INSERT INTO WorkPageInput (id,resultId,revision,kind,entryKey,versionId,content,actorKey) VALUES ('bad','r',1,'response','form:other:x','other','{}','human:owner')")).toThrow();
    } finally { upgraded.close(); installed.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
