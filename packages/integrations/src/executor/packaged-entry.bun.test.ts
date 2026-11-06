import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executorProcessCommand } from "./process";
import { ExecutorJournal, runExecutorProcessEntry } from "./index";

test("source and packaged commands keep trusted entry prefix, approved names and exact child argv", () => {
  const input = { file: "/trusted/pi", args: ["--rpc", "value with spaces"], env: { CHRONA_ALLOWED: "private-env-value" } };
  const source = executorProcessCommand(input, "/private/ready");
  expect(source.slice(0, 2)).toEqual([process.execPath, join(import.meta.dir, "process-entry.ts")]);
  const packaged = executorProcessCommand(input, "/private/ready", { file: "/trusted/chrona", args: ["__executor-process"] });
  expect(packaged).toEqual(["/trusted/chrona", "__executor-process", '["CHRONA_ALLOWED"]', "/private/ready", "/trusted/pi", "--rpc", "value with spaces"]);
  expect(packaged.join(" ")).not.toContain("process-entry.ts");
  expect(packaged.join(" ")).not.toContain("private-env-value");
  expect(source.slice(2)).toEqual(packaged.slice(2));
  expect(typeof ExecutorJournal).toBe("function"); expect(typeof runExecutorProcessEntry).toBe("function");
});

test("export import has no side effect; internal dispatch preserves env allowlist and actual child exit", () => {
  const root = mkdtempSync(join(tmpdir(), "chrona-packaged-entry-test-")), ready = join(root, "ready"), child = join(root, "child.ts"), dispatch = join(root, "dispatch.ts");
  writeFileSync(child, `console.log(JSON.stringify({allowed:process.env.CHRONA_ALLOWED,unknownAbsent:!('CHRONA_MANAGER_ONLY' in process.env),args:process.argv.slice(2)}));process.exit(37);`);
  writeFileSync(dispatch, `import {runExecutorProcessEntry} from ${JSON.stringify(join(import.meta.dir, "index.ts"))};if(process.argv[2]==='__executor-process')await runExecutorProcessEntry(process.argv.slice(3));`);
  const imported = spawnSync(process.execPath, [dispatch], { encoding: "utf8", timeout: 2000 });
  expect(imported.status).toBe(0); expect(imported.stdout).toBe("");
  writeFileSync(ready, "");
  const result = spawnSync(process.execPath, [dispatch, "__executor-process", '["CHRONA_ALLOWED"]', ready, process.execPath, child, "one value"], { encoding: "utf8", env: { CHRONA_ALLOWED: "allow-value", CHRONA_MANAGER_ONLY: "must-not-pass" }, timeout: 3000 });
  expect(result.status).toBe(37);
  expect(JSON.parse(result.stdout)).toEqual({ allowed: "allow-value", unknownAbsent: true, args: ["one value"] });
  expect(existsSync(ready)).toBe(false);
});

test("missing arguments and unadmitted ready gate fail without spawning child", async () => {
  await expect(runExecutorProcessEntry([])).rejects.toThrow("missing trusted launch arguments");
  const root = mkdtempSync(join(tmpdir(), "chrona-entry-gate-test-")), marker = join(root, "spawned"), child = join(root, "child.ts");
  writeFileSync(child, `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'spawned');`);
  const result = spawnSync(process.execPath, [join(import.meta.dir, "process-entry.ts"), "[]", join(root, "never-ready"), process.execPath, child], { encoding: "utf8", timeout: 8000 });
  expect(result.status).not.toBe(0); expect(result.error).toBeUndefined();
  expect(result.stderr).toContain("Executor identity was not durably admitted");
  expect(existsSync(marker)).toBe(false);
}, 10_000);
