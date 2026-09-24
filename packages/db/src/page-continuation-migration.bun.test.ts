import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { checksumSql, ensureSqliteDatabase, schemaFingerprint } from "./sqlite-migrations";

test("committed library baseline upgrades only page guards, preserving every old row and immutable input history", () => {
  const dir = mkdtempSync(join(tmpdir(), "chrona-continuation-")), path = join(dir, "upgrade.sqlite"), fresh = join(dir, "fresh.sqlite");
  const migrationsDir = resolve(import.meta.dir, "../../../prisma/migrations"), fixture = join(migrationsDir, "fixtures/pre-page-continuation.sqlite");
  try {
    expect(checksumSql(readFileSync(fixture))).toBe("85401dd111fdf5fa2a2240dc6b2cbcaec238ec130ee6a633179c594527f68db6"); cpSync(fixture, path);
    const before = new Database(path);
    before.exec(`PRAGMA foreign_keys=ON;
      INSERT INTO Workspace(id,name,status,updatedAt) VALUES('w','Keep','Active',CURRENT_TIMESTAMP);
      INSERT INTO Task(id,workspaceId,title,status,priority,executionConfig,taskExecutionMode,autoPlanGeneration,autoExecute,updatedAt) VALUES('t','w','Keep','Ready','Medium','{}','manual',0,0,CURRENT_TIMESTAMP);
      INSERT INTO TaskResult(id,workspaceId,taskId,scopeKey,updatedAt) VALUES('r','w','t','task',CURRENT_TIMESTAMP);
      INSERT INTO TaskResultVersion(id,resultId,version,content,contentHash,sourceKind,actorKey) VALUES('v','r',1,'{}','${"0".repeat(64)}','external','external:fixture');
      UPDATE TaskResult SET headVersionId='v',editRevision=1 WHERE id='r';
      INSERT INTO WorkPageInput(id,resultId,revision,kind,entryKey,content,actorKey) VALUES('input','r',1,'note','note:keep','{"text":"Keep my note"}','human:owner');
      UPDATE TaskResult SET inputRevision=1 WHERE id='r';
      INSERT INTO LibraryGroup(id,workspaceId,name,nameKey) VALUES('g','w','Topic','topic');
      INSERT INTO LibraryFolder(id,groupId,name,nameKey) VALUES('f','g','Devices','devices');
      INSERT INTO LibraryAssignment(taskId,groupId,folderId,actorKey) VALUES('t','g','f','human:owner');`);
    const tables = before.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name").all() as { name: string }[];
    const original = tables.map(({ name }) => ({ name, rows: before.query(`SELECT * FROM "${name}"`).all() })); before.close();
    expect(ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir }).preUpgradeBackup).toBeTruthy();
    expect(ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir }).preUpgradeBackup).toBeNull();
    ensureSqliteDatabase({ databaseUrl: `file:${fresh}`, migrationsDir });
    const upgraded = new Database(path), installed = new Database(fresh);
    try {
      for (const t of original) expect(upgraded.query(`SELECT * FROM "${t.name}"`).all()).toEqual(t.rows);
      expect(schemaFingerprint(upgraded)).toBe(schemaFingerprint(installed));
      expect(upgraded.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(upgraded.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      upgraded.exec("PRAGMA foreign_keys=ON");
      const insert = (content: string, version = "v") => upgraded.prepare(`INSERT INTO WorkPageInput(id,resultId,revision,kind,entryKey,versionId,content,actorKey) VALUES('request','r',2,'handoff','handoff:one',?,?, 'human:owner')`).run(version, content);
      expect(() => insert('{"text":"continue","snapshotRevision":0}')).toThrow();
      expect(() => insert('{"text":"continue"}')).toThrow();
      expect(() => insert('{"text":"","snapshotRevision":1}')).toThrow();
      expect(() => insert('{"text":"continue","snapshotRevision":1}', "foreign-version")).toThrow();
      insert('{"text":"continue","snapshotRevision":1}'); upgraded.exec("UPDATE TaskResult SET inputRevision=2 WHERE id='r'");
      expect(() => upgraded.exec("UPDATE WorkPageInput SET content='{}' WHERE id='request'")).toThrow();
      expect(() => upgraded.exec("DELETE FROM WorkPageInput WHERE id='request'")).toThrow();
      expect(upgraded.query("SELECT folderId FROM LibraryAssignment WHERE taskId='t'").get()).toEqual({ folderId: "f" });
    } finally { upgraded.close(); installed.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
