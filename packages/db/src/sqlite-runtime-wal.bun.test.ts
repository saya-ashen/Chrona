import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { backupSqliteDatabase } from "./sqlite-backup";

test("runtime adapter uses WAL/FULL and retains committed receipts through abrupt exit and backup", async () => {
  const root = mkdtempSync(join(tmpdir(), "chrona-runtime-wal-test-"));
  const path = join(root, "runtime-test.db"), databaseUrl = `file:${path}`, driver = join(root, "driver.ts");
  try {
    writeFileSync(driver, `
      import { db } from ${JSON.stringify(join(import.meta.dir, "db.ts"))};
      const journal = await db.$queryRawUnsafe('PRAGMA journal_mode');
      const synchronous = await db.$queryRawUnsafe('PRAGMA synchronous');
      const foreignKeys = await db.$queryRawUnsafe('PRAGMA foreign_keys');
      await db.$executeRawUnsafe('PRAGMA wal_autocheckpoint = 0');
      await db.$transaction(async tx => {
        const workspace = await tx.workspace.create({data:{name:'durable-fixture'}});
        await tx.moduleCall.create({data:{workspaceId:workspace.id,hash:'fixture',method:'call',key:'fixed-key',status:'unknown'}});
      });
      console.log(JSON.stringify({journal,synchronous,foreignKeys}, (_, value) => typeof value === 'bigint' ? Number(value) : value));
      process.kill(process.pid, 'SIGKILL');
    `);
    const child = Bun.spawn([process.execPath, driver], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test", CHRONA_CONFIG_DIR: join(root, "config"), DATABASE_URL: databaseUrl }, stdout: "pipe", stderr: "pipe" });
    const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(status).not.toBe(0); expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ journal: [{ journal_mode: "wal" }], synchronous: [{ synchronous: 2 }], foreignKeys: [{ foreign_keys: 1 }] });
    const backup = join(root, "backup.db");
    // No clean disconnect/checkpoint: VACUUM INTO must include the committed WAL.
    backupSqliteDatabase(databaseUrl, backup);
    for (const file of [path, backup]) {
      const db = new Database(file, { readonly: true });
      try {
        expect(db.query('SELECT key, status FROM ModuleCall').all()).toEqual([{ key: "fixed-key", status: "unknown" }]);
        expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      } finally { db.close(); }
    }
    // A fresh runtime connection must set durability again, rather than relying
    // on the journal mode persisted in the database header.
    writeFileSync(driver, `import {db} from ${JSON.stringify(join(import.meta.dir, "db.ts"))}; console.log(JSON.stringify(await db.$queryRawUnsafe('PRAGMA synchronous'), (_, value) => typeof value === 'bigint' ? Number(value) : value)); await db.$disconnect();`);
    const reopen = Bun.spawn([process.execPath, driver], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test", CHRONA_CONFIG_DIR: join(root, "config"), DATABASE_URL: databaseUrl }, stdout: "pipe", stderr: "pipe" });
    const [reopenStatus, reopened, reopenError] = await Promise.all([reopen.exited, new Response(reopen.stdout).text(), new Response(reopen.stderr).text()]);
    expect({ status: reopenStatus, value: JSON.parse(reopened), error: reopenError }).toEqual({ status: 0, value: [{ synchronous: 2 }], error: "" });
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 20_000);
