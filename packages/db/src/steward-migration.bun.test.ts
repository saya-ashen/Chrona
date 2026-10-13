import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { checksumSql, ensureSqliteDatabase, schemaFingerprint, verifyMigrationReleaseMetadata } from "./sqlite-migrations";

const migrationsDir = resolve(import.meta.dir, "../../../prisma/migrations");
const line = "20260917000000_add_work_management";
const sourceChecksum = "ce1507f2ba993846c0217104328faf65b81bda6844d2b4d252974022d5208678";
const models = ["Affair", "SourceConnection", "InboundEvent", "EventAssessment", "Delegation", "AttentionItem", "StewardNotification", "FollowUp", "ManagedTool", "StewardAudit", "StewardState"];

test.each([sourceChecksum, "d40b2835c76cf160e2576988c1b07d32d8751f5bf3b5bdddb2127da4ad6f7dc7"])("checksum %s amendment preserves rows, matches fresh schema and survives repeated startup", (sourceChecksum) => {
  const dir = mkdtempSync(join(import.meta.dir, ".steward-migration-"));
  const path = join(dir, "upgrade.sqlite"), fresh = join(dir, "fresh.sqlite");
  try {
    const metadata = verifyMigrationReleaseMetadata(migrationsDir)!;
    const amendment = metadata.mutableReleaseLineAmendments![sourceChecksum]!;
    const delta = readFileSync(join(migrationsDir, amendment.path), "utf8");
    const current = readFileSync(join(migrationsDir, line, "migration.sql"), "utf8");
    expect(current.endsWith(`\n${delta}`)).toBe(true);
    const oldSql = current.slice(0, -delta.length - 1);
    expect(checksumSql(oldSql)).toBe(sourceChecksum);
    cpSync(join(migrationsDir, "fixtures/v0.3.1-linux-x64.sqlite"), path);
    const before = new Database(path);
    try {
      before.exec(oldSql);
      expect(schemaFingerprint(before)).toBe(amendment.fromSchemaFingerprint);
      before.run(`INSERT INTO _prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count) VALUES('steward-baseline',?,?,CURRENT_TIMESTAMP,1)`, [sourceChecksum, line]);
      before.exec(`INSERT INTO Workspace(id,name,status,updatedAt) VALUES('preserved','Keep','Active',CURRENT_TIMESTAMP)`);
      if (sourceChecksum.startsWith("d40b")) before.exec(`INSERT INTO ManagedTool(id,workspaceId,kind,name,purpose,handlingMode,selectionRationale,updatedAt) VALUES('kept','preserved','script','Keep','Test','script','Stable',CURRENT_TIMESTAMP)`);
    } finally { before.close(); }
    expect(ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir }).preUpgradeBackup).toBeTruthy();
    expect(ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir }).preUpgradeBackup).toBeNull();
    ensureSqliteDatabase({ databaseUrl: `file:${fresh}`, migrationsDir });
    const after = new Database(path), installed = new Database(fresh);
    try {
      expect(after.query("SELECT name FROM Workspace WHERE id='preserved'").get()).toEqual({ name: "Keep" });
      expect(schemaFingerprint(after)).toBe(schemaFingerprint(installed));
      expect(schemaFingerprint(after)).toBe(metadata.releaseLineSchemaFingerprint);
      for (const name of models) expect(after.query(`SELECT COUNT(*) AS n FROM "${name}"`).get()).toEqual({ n: name === "ManagedTool" && sourceChecksum.startsWith("d40b") ? 1 : 0 });
      if (sourceChecksum.startsWith("d40b")) expect(after.query("SELECT spec,disabledAt,retiredAt FROM ManagedTool WHERE id='kept'").get()).toEqual({ spec: "{}", disabledAt: null, retiredAt: null });
      expect(after.query("PRAGMA table_info('ManagedTool')").all().map((c) => (c as { name: string }).name)).toContain("spec");
      expect(after.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(after.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    } finally { after.close(); installed.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("steward dedupe, JSON defaults, workspace scope and append-only audit are enforced", () => {
  const dir = mkdtempSync(join(import.meta.dir, ".steward-guards-"));
  const path = join(dir, "fresh.sqlite");
  try {
    ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir });
    const db = new Database(path);
    try {
      db.exec(`PRAGMA foreign_keys=ON;
        INSERT INTO Workspace(id,name,status,updatedAt) VALUES('w','One','Active',CURRENT_TIMESTAMP),('other','Two','Active',CURRENT_TIMESTAMP);
        INSERT INTO SourceConnection(id,workspaceId,kind,label,updatedAt) VALUES('c','w','local_test','Test',CURRENT_TIMESTAMP);
        INSERT INTO InboundEvent(id,workspaceId,connectionId,externalId,title,body,author,occurredAt) VALUES('e','w','c','external','Title','Body','Author',CURRENT_TIMESTAMP);
        INSERT INTO Delegation(id,workspaceId,purpose,updatedAt) VALUES('d','w','Watch',CURRENT_TIMESTAMP);
        INSERT INTO AttentionItem(id,workspaceId,dedupeKey,kind,title,whatHappened,whyItMatters,nextStep,updatedAt) VALUES('a','w','key','change','Title','What','Why','Next',CURRENT_TIMESTAMP);
        INSERT INTO StewardNotification(id,workspaceId,attentionItemId,delegationId,idempotencyKey,channel,title,body) VALUES('n','w','a','d','once','local_test','Title','Body');
        INSERT INTO StewardState(workspaceId) VALUES('w');
        INSERT INTO StewardAudit(id,workspaceId,kind,actorKey,details) VALUES('audit','w','decision','human','{}');`);
      expect(db.query("SELECT config,readScopes,status FROM SourceConnection WHERE id='c'").get()).toEqual({ config: "{}", readScopes: "[]", status: "needs_authorization" });
      expect(() => db.exec(`INSERT INTO InboundEvent(id,workspaceId,connectionId,externalId,title,body,author,occurredAt) VALUES('dup','w','c','external','','','',CURRENT_TIMESTAMP)`)).toThrow();
      expect(() => db.exec(`INSERT INTO AttentionItem(id,workspaceId,dedupeKey,kind,title,whatHappened,whyItMatters,nextStep,updatedAt) VALUES('dup','w','key','change','','','','',CURRENT_TIMESTAMP)`)).toThrow();
      expect(() => db.exec(`INSERT INTO StewardNotification(id,workspaceId,idempotencyKey,channel,title,body) VALUES('dup','w','once','local_test','','')`)).toThrow();
      expect(() => db.exec(`INSERT INTO StewardState(workspaceId) VALUES('w')`)).toThrow();
      expect(() => db.exec(`INSERT INTO InboundEvent(id,workspaceId,connectionId,externalId,title,body,author,occurredAt) VALUES('cross','other','c','cross','','','',CURRENT_TIMESTAMP)`)).toThrow("outside workspace");
      expect(() => db.exec(`UPDATE InboundEvent SET workspaceId='other' WHERE id='e'`)).toThrow();
      expect(() => db.exec(`UPDATE StewardAudit SET details='[]' WHERE id='audit'`)).toThrow("append-only");
      expect(() => db.exec(`DELETE FROM StewardAudit WHERE id='audit'`)).toThrow("append-only");
      db.exec(`DELETE FROM Workspace WHERE id='w'`);
      expect(db.query("SELECT COUNT(*) AS n FROM StewardAudit").get()).toEqual({ n: 0 });
      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
