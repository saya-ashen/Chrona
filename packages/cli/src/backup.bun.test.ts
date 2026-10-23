import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("CLI backup/restore selects CHRONA_DATA_DIR independently of DATABASE_URL", () => {
  const temp = mkdtempSync(join(tmpdir(), "chrona-cli-backup-"));
  try {
    const data = join(temp, "data");
    mkdirSync(join(data, "platform", "content"), { recursive: true });
    mkdirSync(join(data, "secrets"));
    writeFileSync(join(data, "platform", "content", "README.md"), "saved");
    writeFileSync(join(data, "secrets", "test.json"), "private-test");
    const path = join(temp, "separate.db");
    const db = new Database(path);
    db.run("CREATE TABLE example (value TEXT)");
    db.close();
    const env = { ...process.env, CHRONA_DATA_DIR: data, DATABASE_URL: `file:${path}` };
    const run = (...args: string[]) => Bun.spawnSync([process.execPath, "run", "packages/cli/src/index.ts", ...args], { env });
    const backup = join(temp, "backup.db");
    expect(run("backup", backup).exitCode).toBe(0);
    expect(existsSync(`${backup}.tar`)).toBe(true);
    writeFileSync(join(data, "platform", "content", "README.md"), "changed");
    expect(run("restore", backup).exitCode).not.toBe(0);
    expect(run("restore", backup, "--force").exitCode).toBe(0);
    expect(readFileSync(join(data, "platform", "content", "README.md"), "utf8")).toBe("saved");
    expect(readFileSync(join(data, "secrets", "test.json"), "utf8")).toBe("private-test");
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
