import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createProgram, type StartCommandOptions } from "./program";

test("Chrona retains its local commands and explicit start options", async () => {
  const starts: StartCommandOptions[] = [];
  const program = createProgram({ startServer: async options => { starts.push(options); } });
  expect(program.commands.map(command => command.name())).toEqual(["start", "backup", "restore", "doctor", "admin"]);
  await program.parseAsync(["start", "--host", "0.0.0.0", "--port", "4310", "--no-open"], { from: "user" });
  expect(starts).toEqual([{ host: "0.0.0.0", port: "4310", open: false }]);
});

for (const entry of ["index.ts", "bun-entry.ts"]) {
  test(`${entry} help and removed commands never initialize private server state or execute a child`, () => {
    const root = mkdtempSync(join(tmpdir(), "chrona-cli-help-"));
    const config = join(root, "config"), data = join(root, "data"), marker = join(root, "child-ran");
    const env = { ...process.env, DATABASE_URL: "invalid:test-must-not-load", CHRONA_CONFIG_DIR: config, CHRONA_DATA_DIR: data, API_KEY: "test-owner-sentinel" };
    const run = (...args: string[]) => spawnSync(process.execPath, [resolve(import.meta.dir, entry), ...args], { cwd: root, env, encoding: "utf8", timeout: 10_000 });
    try {
      const help = run("--help");
      expect(help.status, help.stderr).toBe(0);
      expect(help.stdout).toContain("start"); expect(help.stdout).toContain("admin");
      expect(help.stdout).not.toMatch(/executor|owner.?key|device/i);
      const legacy = run("executor", "run");
      expect(legacy.status).not.toBe(0); expect(legacy.stderr).toContain("unknown command");
      const dispatch = run("__executor-process", "[]", marker, process.execPath, "-e", `Bun.write(${JSON.stringify(marker)}, "ran")`);
      expect(dispatch.status).not.toBe(0); expect(dispatch.stderr).toContain("unknown command");
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(config)).toBe(false); expect(existsSync(data)).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
