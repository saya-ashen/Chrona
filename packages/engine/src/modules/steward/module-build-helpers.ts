import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Pi has no /chrona mount. Adapt only temporary copies; submitted sources keep sandbox imports.
const RUN_TESTS = String.raw`#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then echo 'Usage: chrona/run-tests.sh <moduledir>' >&2; exit 2; fi
helpers=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec bun run - "$helpers" "$1" <<'JS'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const [helpers, source] = process.argv.slice(2);
const temp = await mkdtemp(join(tmpdir(), "chrona-module-tests-"));
let exitCode = 0;
try {
  const moduleDir = join(temp, "module"), helperDir = join(temp, "chrona");
  await cp(resolve(source), moduleDir, { recursive: true });
  await cp(helpers, helperDir, { recursive: true });
  // The testing helper reads the manifest at Chrona's /module mount.
  const testing = join(helperDir, "testing.ts");
  const testingSource = await readFile(testing, "utf8");
  await rm(testing);
  await writeFile(testing, testingSource.replaceAll('"/module/module.json"', JSON.stringify(join(moduleDir, "module.json"))));
  async function rewrite(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await rewrite(path);
      else if (entry.isFile() && /\.(?:[cm]?[jt]sx?)$/.test(entry.name)) {
        const text = await readFile(path, "utf8");
        const changed = text.replace(/(["'])\/chrona\/(sdk|testing)\.ts\1/g,
          (_, quote, name) => JSON.stringify(join(helperDir, name + ".ts")));
        if (changed !== text) { await rm(path); await writeFile(path, changed); }
      }
    }
  }
  await rewrite(moduleDir);
  const manifest = JSON.parse(await readFile(join(moduleDir, "module.json"), "utf8"));
  for (const test of manifest.tests) {
    console.log("Chrona module test: " + test);
    const result = spawnSync(process.execPath, [test], { cwd: moduleDir, stdio: "inherit", timeout: 60000 });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) { exitCode = result.status || 1; break; }
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
process.exitCode = exitCode;
JS
`;

export async function writeBuildHelpers(cwd: string, resources: { sdk: string; testing: string }) {
  const dir = join(cwd, "chrona");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "sdk.ts"), await readFile(resources.sdk), { mode: 0o444 });
  await writeFile(join(dir, "testing.ts"), await readFile(resources.testing), { mode: 0o444 });
  await writeFile(join(dir, "run-tests.sh"), RUN_TESTS, { mode: 0o555 });
}
