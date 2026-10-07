import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { checksumSql, ensureSqliteDatabase, schemaFingerprint, verifyMigrationReleaseMetadata } from "./sqlite-migrations";

test("pre-library database upgrades additively; grouped classifications preserve all existing data and enforce unique scoped placements", () => {
  const dir = mkdtempSync(join(tmpdir(), "chrona-library-upgrade-")), path = join(dir, "upgrade.sqlite"), fresh = join(dir, "fresh.sqlite");
  const migrationsDir = resolve(import.meta.dir, "../../../prisma/migrations"), fixture = join(migrationsDir, "fixtures/pre-library.sqlite");
  try {
    expect(checksumSql(readFileSync(fixture))).toBe("1f609117046d586768f30840ea5df4774d45162f19708522b2285d727b9dbfbf"); cpSync(fixture, path);
    const before = new Database(path);
    before.exec(`PRAGMA foreign_keys=ON;
      INSERT INTO Workspace(id,name,status,updatedAt) VALUES('w','Keep','Active',CURRENT_TIMESTAMP),('other','Other','Active',CURRENT_TIMESTAMP);
      INSERT INTO Task(id,workspaceId,title,status,priority,executionConfig,taskExecutionMode,autoPlanGeneration,autoExecute,updatedAt) VALUES('t','w','Keep','Ready','Medium','{}','manual',0,0,CURRENT_TIMESTAMP);
      INSERT INTO TaskResult(id,workspaceId,taskId,scopeKey,updatedAt) VALUES('r','w','t','task',CURRENT_TIMESTAMP);
      INSERT INTO TaskResultVersion(id,resultId,version,content,contentHash,sourceKind,actorKey) VALUES('v','r',1,'{}','${"0".repeat(64)}','external','external:fixture');
      UPDATE TaskResult SET headVersionId='v',editRevision=1 WHERE id='r';
      INSERT INTO WorkPageInput(id,resultId,revision,kind,entryKey,content,actorKey) VALUES('input','r',1,'note','note:keep','{"text":"Keep my note"}','human:owner');
      UPDATE TaskResult SET inputRevision=1 WHERE id='r';
      INSERT INTO WorkRecord(taskId,workspaceId,context,signals,lastActorKey,updatedAt) VALUES('t','w','{"kind":"general"}','{}','owner:local',CURRENT_TIMESTAMP);`);
    const tables = before.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name").all() as { name: string }[];
    const original = tables.map(({ name }) => ({ name, rows: before.query(`SELECT * FROM "${name}"`).all() }));
    const oldFingerprint = schemaFingerprint(before); before.close();
    const metadata = verifyMigrationReleaseMetadata(migrationsDir)!;
    expect(Object.values(metadata.mutableReleaseLineAmendments ?? {}).some(v => v.fromSchemaFingerprint === oldFingerprint)).toBe(true);
    expect(ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir }).preUpgradeBackup).toBeTruthy();
    expect(ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir }).preUpgradeBackup).toBeNull();
    ensureSqliteDatabase({ databaseUrl: `file:${fresh}`, migrationsDir });
    const upgraded = new Database(path), installed = new Database(fresh);
    try {
      for (const t of original) expect(upgraded.query(`SELECT * FROM "${t.name}"`).all()).toEqual(t.rows);
      expect(schemaFingerprint(upgraded)).toBe(schemaFingerprint(installed)); expect(schemaFingerprint(upgraded)).toBe(metadata.releaseLineSchemaFingerprint);
      expect(upgraded.query("PRAGMA foreign_key_check").all()).toEqual([]); expect(upgraded.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      upgraded.exec(`PRAGMA foreign_keys=ON; INSERT INTO LibraryGroup(id,workspaceId,name,nameKey) VALUES('g','w','Theme','theme'),('g2','w','Owner','owner'),('foreign','other','Other','other');
        INSERT INTO LibraryFolder(id,groupId,name,nameKey) VALUES('f','g','PC','pc'),('f2','g2','Family','family');
        INSERT INTO LibraryAssignment(taskId,groupId,folderId,actorKey) VALUES('t','g','f','owner:local'),('t','g2','f2','owner:local');`);
      expect(() => upgraded.exec("INSERT INTO LibraryAssignment(taskId,groupId,folderId,actorKey) VALUES('t','g','f','duplicate')")).toThrow();
      expect(() => upgraded.exec("UPDATE LibraryAssignment SET folderId='f2' WHERE groupId='g'")).toThrow();
      expect(() => upgraded.exec("INSERT INTO LibraryAssignment(taskId,groupId,actorKey) VALUES('t','foreign','bad')")).toThrow();
      expect(() => upgraded.exec("UPDATE Task SET workspaceId='other' WHERE id='t'")).toThrow();
      upgraded.exec("DELETE FROM LibraryFolder WHERE id='f'");
      expect(upgraded.query("SELECT folderId FROM LibraryAssignment WHERE groupId='g'").get()).toEqual({ folderId: null });
      expect(upgraded.query("SELECT folderId FROM LibraryAssignment WHERE groupId='g2'").get()).toEqual({ folderId: "f2" });
      for (const t of original) expect(upgraded.query(`SELECT * FROM "${t.name}"`).all()).toEqual(t.rows);
      // Workspace deletion must not depend on SQLite's child-cascade order.
      upgraded.exec(`INSERT INTO LibraryState(workspaceId) VALUES('other');
        INSERT INTO LibraryCommand(id,workspaceId,actorKey,requestId,payloadHash,receipt) VALUES('command','other','owner:test','request','${"0".repeat(64)}','{}');`);
      expect(() => upgraded.exec("DELETE FROM LibraryCommand WHERE id='command'")).toThrow();
      upgraded.exec("DELETE FROM Workspace WHERE id='other'");
      expect(upgraded.query("SELECT id FROM LibraryCommand WHERE id='command'").all()).toEqual([]);
      expect(upgraded.query("SELECT id FROM LibraryGroup WHERE id='foreign'").all()).toEqual([]);
      expect(upgraded.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { upgraded.close(); installed.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
