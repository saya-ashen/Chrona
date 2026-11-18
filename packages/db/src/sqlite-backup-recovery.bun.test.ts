import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { backupSqliteDatabase, recoverInterruptedSqliteRestore, restoreSqliteDatabase } from "./sqlite-backup";
import { backupDataRoots } from "./sqlite-backup-files";

function createDatabase(path: string, value: string) {
  const db = new Database(path);
  try {
    db.exec("CREATE TABLE Example(value TEXT)");
    db.query("INSERT INTO Example VALUES (?)").run(value);
  } finally { db.close(); }
}
function readValue(path: string) {
  const db = new Database(path, { readonly: true });
  try { return (db.query("SELECT value FROM Example").get() as { value: string }).value; }
  finally { db.close(); }
}
function fixture(run: (db: string, backup: string, data: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "chrona-whole-restore-recovery-"));
  try {
    const db = join(directory, "active.db"), backup = join(directory, "backup.db"), data = join(directory, "data");
    createDatabase(db, "saved");
    for (const root of backupDataRoots) {
      mkdirSync(join(data, root), { recursive: true });
      writeFileSync(join(data, root, "value"), "saved");
    }
    backupSqliteDatabase(`file:${db}`, backup, data);
    const database = new Database(db);
    try { database.exec("UPDATE Example SET value = 'current'"); } finally { database.close(); }
    for (const root of backupDataRoots) writeFileSync(join(data, root, "value"), "current");
    run(db, backup, data);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
function interrupt(db: string, backup: string, data: string, step: string, occurrence = 1, recovery = false) {
  const source = `
    import { restoreSqliteDatabase, recoverInterruptedSqliteRestore } from ${JSON.stringify(join(import.meta.dir, "sqlite-backup.ts"))};
    let remaining = ${occurrence};
    const stop = step => { if (step === ${JSON.stringify(step)} && --remaining === 0) process.exit(73); };
    ${recovery
      ? `recoverInterruptedSqliteRestore(${JSON.stringify(`file:${db}`)}, stop);`
      : `restoreSqliteDatabase(${JSON.stringify(`file:${db}`)}, ${JSON.stringify(backup)}, { force: true, dataDir: ${JSON.stringify(data)}, onRestoreStep: stop });`}
  `;
  const result = spawnSync(process.execPath, ["--no-install", "-e", source], { encoding: "utf8" });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 73, stderr: "" });
}
function expectCurrent(db: string, data: string) {
  expect(readValue(db)).toBe("current");
  for (const root of backupDataRoots) expect(readFileSync(join(data, root, "value"), "utf8")).toBe("current");
  expect(existsSync(`${db}.restore.json`)).toBe(false);
}

const interruptions = [
  ["staged", 1], ["replacing", 1],
  ...Array.from({ length: 6 }, (_, index) => ["root_replaced", index + 1] as const),
  ["database_retired", 1], ["database_replaced", 1],
] as const;
test.each(interruptions)("whole restore recovers the original DB and all roots after %s #%i", (step, occurrence) => {
  fixture((db, backup, data) => {
    interrupt(db, backup, data, step, occurrence);
    recoverInterruptedSqliteRestore(`file:${db}`);
    expectCurrent(db, data);
  });
});

const recoveryInterruptions = [
  ["recovery_database_retired", 1], ["recovery_database_staged", 1], ["recovery_database_replaced", 1],
  ["database_recovered", 1],
  ...Array.from({ length: 6 }, (_, index) => ["root_recovered", index + 1] as const),
  ["recovered", 1], ["cleaned", 1],
] as const;
test.each(recoveryInterruptions)("whole restore recovery can itself stop at %s #%i", (step, occurrence) => {
  fixture((db, backup, data) => {
    interrupt(db, backup, data, "database_replaced");
    interrupt(db, backup, data, step, occurrence, true);
    recoverInterruptedSqliteRestore(`file:${db}`);
    expectCurrent(db, data);
  });
});

test("backup refuses an uncommitted restore instead of archiving a mixed state", () => {
  fixture((db, backup, data) => {
    interrupt(db, backup, data, "root_replaced", 2);
    expect(() => backupSqliteDatabase(`file:${db}`, `${backup}.mixed`)).toThrow("Recover the interrupted restore");
    recoverInterruptedSqliteRestore(`file:${db}`);
    expectCurrent(db, data);
  });
});

test("a committed whole restore finishes cleanup with the restored DB and roots", () => {
  fixture((db, backup, data) => {
    interrupt(db, backup, data, "replaced");
    recoverInterruptedSqliteRestore(`file:${db}`);
    expect(readValue(db)).toBe("saved");
    for (const root of backupDataRoots) expect(readFileSync(join(data, root, "value"), "utf8")).toBe("saved");
    expect(existsSync(`${db}.restore.json`)).toBe(false);
  });
});

test.each([...backupDataRoots])("recovery restores an originally absent DB and %s root to absence", root => {
  fixture((db, backup, data) => {
    rmSync(db);
    rmSync(join(data, root), { recursive: true });
    interrupt(db, backup, data, "database_replaced");
    interrupt(db, backup, data, "root_recovered", 1, true);
    recoverInterruptedSqliteRestore(`file:${db}`);
    expect(existsSync(db)).toBe(false);
    expect(existsSync(join(data, root))).toBe(false);
    for (const other of backupDataRoots.filter(other => other !== root)) {
      expect(readFileSync(join(data, other, "value"), "utf8")).toBe("current");
    }
  });
});

test("whole restore failure after WAL retirement recovers the WAL-aware DB and original roots", () => {
  fixture((db, backup, data) => {
    const writer = new Database(db);
    try {
      writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE Example SET value='current-wal'");
      expect(() => restoreSqliteDatabase(`file:${db}`, backup, {
        force: true, dataDir: data,
        onSidecarsRemoved() { throw new Error("injected sidecar interruption"); },
      })).toThrow("injected sidecar interruption");
      expect(readValue(db)).toBe("current-wal");
      for (const root of backupDataRoots) expect(readFileSync(join(data, root, "value"), "utf8")).toBe("current");
    } finally { writer.close(); }
  });
});

test.skipIf(process.platform !== "linux")("restore and startup recovery refuse a private process, including in a retired root", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chrona-restore-process-"));
  let child: Bun.Subprocess<"ignore", "pipe", "ignore"> | undefined;
  try {
    const db = join(directory, "active.db"), backup = join(directory, "backup.db"), data = join(directory, "data");
    createDatabase(db, "current");
    mkdirSync(join(data, "platform"), { recursive: true });
    writeFileSync(join(data, "platform", "value"), "current");
    backupSqliteDatabase(`file:${db}`, backup, data);
    child = Bun.spawn([process.execPath, "-e", "console.log('ready');setInterval(()=>{},1000)"], { cwd: join(data, "platform"), stdout: "pipe", stderr: "ignore" });
    const reader = child.stdout.getReader();
    await reader.read(); reader.releaseLock();
    expect(() => restoreSqliteDatabase(`file:${db}`, backup, { force: true, dataDir: data })).toThrow("stopped application processes");
    expect(existsSync(`${db}.restore.json`)).toBe(false);
    child.kill(); await child.exited;
    interrupt(db, backup, data, "root_replaced", 1);
    const marker = JSON.parse(readFileSync(`${db}.restore.json`, "utf8"));
    child = Bun.spawn([process.execPath, "-e", "console.log('ready');setInterval(()=>{},1000)"], { cwd: `${marker.files.stage}-prior-platform`, stdout: "pipe", stderr: "ignore" });
    const next = child.stdout.getReader();
    await next.read(); next.releaseLock();
    expect(() => recoverInterruptedSqliteRestore(`file:${db}`)).toThrow("stopped application processes");
    child.kill(); await child.exited;
    recoverInterruptedSqliteRestore(`file:${db}`);
    expect(readValue(db)).toBe("current");
  } finally {
    if (child) { child.kill(); await child.exited; }
    rmSync(directory, { recursive: true, force: true });
  }
});
