import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { backupSqliteDatabase, restoreSqliteDatabase } from "./sqlite-backup";

const markerName = ".chrona-restore.json";
const oldMarker = JSON.stringify({ version: 1, id: "old-generation", restoredAt: "2000-01-01T00:00:00.000Z" });

function fixture(directory: string) {
  const data = join(directory, "data");
  const db = join(directory, "active.db");
  const backup = join(directory, "backup.db");
  const app = join(data, "platform/data/app");
  const empty = join(data, "platform/data/empty");
  mkdirSync(join(app, "nested"), { recursive: true });
  mkdirSync(empty);
  writeFileSync(join(app, "nested/checkpoint.json"), '{"private":"saved checkpoint"}');
  writeFileSync(join(app, markerName), oldMarker, { mode: 0o700 });
  writeFileSync(join(data, "platform/data/ordinary-file"), "saved file");
  const database = new Database(db);
  try {
    database.run("CREATE TABLE Example (value TEXT)");
    database.run("INSERT INTO Example VALUES ('saved')");
  } finally { database.close(); }
  backupSqliteDatabase(`file:${db}`, backup, data);
  return { data, db, backup, app, empty };
}

function readValue(db: string): string {
  const database = new Database(db, { readonly: true });
  try {
    return (database.query("SELECT value FROM Example").get() as { value: string }).value;
  } finally { database.close(); }
}

function changeDatabase(db: string): void {
  const database = new Database(db);
  try { database.run("UPDATE Example SET value = 'current'"); }
  finally { database.close(); }
}

function readMarker(app: string): { version: number; id: string; restoredAt: string } {
  return JSON.parse(readFileSync(join(app, markerName), "utf8"));
}

describe("whole-backup restore generation", () => {
  it("stamps every app directory with one fresh generation per restore, replacing archived markers", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-restore-generation-"));
    try {
      const { data, db, backup, app, empty } = fixture(directory);
      const archived = readFileSync(`${backup}.tar`);
      changeDatabase(db);
      writeFileSync(join(app, "nested/checkpoint.json"), "current checkpoint");
      let previousId = "old-generation";
      for (let restore = 0; restore < 2; restore++) {
        const started = Date.now();
        restoreSqliteDatabase(`file:${db}`, backup, { force: true, dataDir: data });
        const marker = readMarker(app);
        expect(Object.keys(marker).sort()).toEqual(["id", "restoredAt", "version"]);
        expect(marker.version).toBe(1);
        expect(marker.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(marker.id).not.toBe(previousId);
        expect(marker.id).not.toBe("old-generation");
        expect(new Date(marker.restoredAt).toISOString()).toBe(marker.restoredAt);
        expect(Date.parse(marker.restoredAt)).toBeGreaterThanOrEqual(started);
        expect(Date.parse(marker.restoredAt)).toBeLessThanOrEqual(Date.now());
        expect(readMarker(empty)).toEqual(marker);
        expect(existsSync(join(app, "nested", markerName))).toBe(false);
        expect(existsSync(join(data, "platform/data", markerName))).toBe(false);
        expect(readFileSync(join(data, "platform/data/ordinary-file"), "utf8")).toBe("saved file");
        expect(readFileSync(join(app, "nested/checkpoint.json"), "utf8")).toBe('{"private":"saved checkpoint"}');
        expect(readValue(db)).toBe("saved");
        if (process.platform !== "win32") expect(statSync(join(app, markerName)).mode & 0o777).toBe(0o600);
        previousId = marker.id;
      }
      expect(readFileSync(`${backup}.tar`)).toEqual(archived);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("exposes staged markers before database replacement and rolls current directories back on failure", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-restore-generation-rollback-"));
    try {
      const { data, db, backup, app, empty } = fixture(directory);
      const currentMarker = '{"current":"marker bytes"}\n';
      writeFileSync(join(app, markerName), currentMarker);
      writeFileSync(join(app, "nested/checkpoint.json"), "current checkpoint");
      changeDatabase(db);
      let attemptedReplacement = false;
      expect(() => restoreSqliteDatabase(`file:${db}`, backup, {
        force: true,
        dataDir: data,
        rename() {
          attemptedReplacement = true;
          expect(readMarker(app).id).not.toBe("old-generation");
          expect(readMarker(empty)).toEqual(readMarker(app));
          throw new Error("injected database replacement failure");
        },
      })).toThrow("injected database replacement failure");
      expect(attemptedReplacement).toBe(true);
      expect(readFileSync(join(app, markerName), "utf8")).toBe(currentMarker);
      expect(existsSync(join(empty, markerName))).toBe(false);
      expect(readFileSync(join(app, "nested/checkpoint.json"), "utf8")).toBe("current checkpoint");
      expect(readValue(db)).toBe("current");
      expect(readdirSync(data).some(name => name.startsWith(".restore-files-"))).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("cleans a failed marker stage before touching current data", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-restore-generation-stage-failure-"));
    try {
      const { data, db, app } = fixture(directory);
      // A directory at the reserved filename cannot be overwritten with a marker.
      rmSync(join(app, markerName));
      mkdirSync(join(app, markerName));
      const backup = join(directory, "marker-directory.db");
      backupSqliteDatabase(`file:${db}`, backup, data);
      rmSync(join(app, markerName), { recursive: true });
      writeFileSync(join(app, markerName), oldMarker);
      changeDatabase(db);
      expect(() => restoreSqliteDatabase(`file:${db}`, backup, { force: true, dataDir: data })).toThrow();
      expect(readFileSync(join(app, markerName), "utf8")).toBe(oldMarker);
      expect(readValue(db)).toBe("current");
      expect(readdirSync(data).some(name => name.startsWith(".restore-files-"))).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("leaves app markers and private files untouched for database-only restore even with a companion archive", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-restore-generation-db-only-"));
    try {
      const { data, db, backup, app, empty } = fixture(directory);
      const currentMarker = '{"current":"keep exact bytes"}\n';
      writeFileSync(join(app, markerName), currentMarker);
      writeFileSync(join(app, "nested/checkpoint.json"), "current checkpoint");
      changeDatabase(db);
      restoreSqliteDatabase(`file:${db}`, backup, { force: true });
      expect(readValue(db)).toBe("saved");
      expect(readFileSync(join(app, markerName), "utf8")).toBe(currentMarker);
      expect(existsSync(join(empty, markerName))).toBe(false);
      expect(readFileSync(join(app, "nested/checkpoint.json"), "utf8")).toBe("current checkpoint");
      expect(readdirSync(data).some(name => name.startsWith(".restore-files-"))).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
