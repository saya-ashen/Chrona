import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checksumSql, ensureSqliteDatabase, schemaFingerprint, verifyMigrationReleaseMetadata } from "./sqlite-migrations";

const migrationsDir = resolve(import.meta.dir, "../../../prisma/migrations");
const metadata = verifyMigrationReleaseMetadata(migrationsDir)!;
const fixturePath = join(migrationsDir, "fixtures/pre-work-results.sqlite");
function withCopy(test: (path: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "chrona-work-results-migration-"));
  const path = join(root, "chrona.db");
  cpSync(fixturePath, path);
  try { test(path); } finally { rmSync(root, { recursive: true, force: true }); }
}

describe("work-result storage migration", () => {
  it("upgrades the exact pre-B1 mutable checksum with a verified backup and unchanged task state", () => withCopy((path) => {
    expect(checksumSql(readFileSync(fixturePath))).toBe("03c33bd10e47f75a91b628bd15480b6f24b2a07891f65ec0857a313d29c05b73");
    const before = new Database(path);
    before.run(`INSERT INTO Workspace (id,name,status,updatedAt) VALUES ('workspace','Original','Active',CURRENT_TIMESTAMP);
      INSERT INTO Task (id,workspaceId,title,executionConfig,status,priority,taskExecutionMode,updatedAt) VALUES ('task','workspace','Original task','{}','WaitingForApproval','High','manual',CURRENT_TIMESTAMP);`);
    const history = before.query("SELECT migration_name,checksum,applied_steps_count FROM _prisma_migrations ORDER BY migration_name").all();
    const task = before.query("SELECT * FROM Task").get();
    before.close();
    const result = ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir });
    expect(result.preUpgradeBackup).toBeTruthy();
    const backup = new Database(result.preUpgradeBackup!.backupPath, { readonly: true });
    try { expect(backup.query("SELECT migration_name,checksum,applied_steps_count FROM _prisma_migrations ORDER BY migration_name").all()).toEqual(history); } finally { backup.close(); }
    const after = new Database(path, { readonly: true });
    try {
      expect(schemaFingerprint(after)).toBe(metadata.releaseLineSchemaFingerprint);
      expect(after.query("SELECT * FROM Task").get()).toEqual(task);
      for (const table of ["TaskResult", "TaskResultVersion", "TaskResultReview", "ResultCommand", "ResultVersionArtifact"]) expect(after.query(`SELECT * FROM "${table}"`).all()).toEqual([]);
      expect(after.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { after.close(); }
    expect(ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir }).preUpgradeBackup).toBeNull();
  }));

  it("enforces scope, same-result pointers, monotonic revisions and append-only review receipts", () => withCopy((path) => {
    ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir });
    const db = new Database(path);
    try {
      db.run(`PRAGMA foreign_keys = ON;
        INSERT INTO Workspace (id,name,status,updatedAt) VALUES ('w','Workspace','Active',CURRENT_TIMESTAMP);
        INSERT INTO Task (id,workspaceId,title,executionConfig,status,priority,updatedAt) VALUES ('t1','w','One','{}','Ready','Medium',CURRENT_TIMESTAMP), ('t2','w','Two','{}','Ready','Medium',CURRENT_TIMESTAMP);`);
      const insert = (id: string, taskId: string, workspaceId = "w", scopeKey = "task") => db.run("INSERT INTO TaskResult (id,workspaceId,taskId,scopeKey,updatedAt) VALUES (?,?,?,?,CURRENT_TIMESTAMP)", [id, workspaceId, taskId, scopeKey]);
      expect(() => insert("wrong-workspace", "t1", "missing")).toThrow();
      expect(() => insert("wrong-scope", "t1", "w", "occurrence:missing")).toThrow();
      insert("r1", "t1"); insert("r2", "t2");
      expect(() => insert("duplicate-task-scope", "t1")).toThrow();
      for (const n of [1, 2]) {
        db.run("INSERT INTO TaskResultVersion (id,resultId,version,content,contentHash,sourceKind,actorKey) VALUES (?,?,1,'{}',?,'human','human:actor')", [`v${n}`, `r${n}`, "0".repeat(64)]);
        db.run("UPDATE TaskResult SET headVersionId=?,editRevision=1 WHERE id=?", [`v${n}`, `r${n}`]);
      }
      expect(() => db.run("UPDATE TaskResult SET acceptedVersionId='v2',editRevision=2 WHERE id='r1'")).toThrow();
      expect(() => db.run("UPDATE TaskResult SET editRevision=1 WHERE id='r1'")).toThrow();
      expect(() => db.run("UPDATE TaskResult SET taskId='t2',editRevision=2 WHERE id='r1'")).toThrow();
      expect(() => db.run("INSERT INTO TaskResultVersion (id,resultId,version,parentVersionId,content,contentHash,sourceKind,actorKey) VALUES ('bad-parent','r1',2,'v2','{}',?,'human','human:actor')", ["0".repeat(64)])).toThrow();
      db.run("INSERT INTO ResultCommand (id,workspaceId,actorKey,operation,requestId,payloadHash,resultId,versionId,receipt) VALUES ('command','w','human:actor','review','request',?,'r1','v1','{}')", ["0".repeat(64)]);
      db.run("INSERT INTO TaskResultReview (id,resultId,versionId,commandId,revision,decision,actorKey) VALUES ('review','r1','v1','command',2,'accept','human:actor')");
      expect(() => db.run("UPDATE ResultCommand SET receipt='{}' WHERE id='command'")).toThrow();
      expect(() => db.run("UPDATE TaskResultReview SET decision='reject' WHERE id='review'")).toThrow();
      db.run("UPDATE TaskResult SET acceptedVersionId='v1',editRevision=2 WHERE id='r1'");
      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  }));

  it("rejects pre-B1 schema drift without partially creating new result tables", () => withCopy((path) => {
    const before = new Database(path); before.run("CREATE TABLE Unexpected (id TEXT)"); before.close();
    expect(() => ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir })).toThrow("source schema mismatch");
    const after = new Database(path, { readonly: true });
    try { expect(after.query("SELECT name FROM sqlite_master WHERE name = 'TaskResult'").get()).toBeNull(); } finally { after.close(); }
  }));
});
