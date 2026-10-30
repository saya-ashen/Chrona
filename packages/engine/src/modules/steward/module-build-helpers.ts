import { cp, chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Modules import the SDK as `chrona`; node_modules/chrona in the build directory resolves it for every module subdirectory.
const RUN_TESTS = String.raw`#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then echo 'Usage: chrona/run-tests.sh <moduledir>' >&2; exit 2; fi
cd -- "$1"
for test in $(bun --no-install -e 'console.log(JSON.parse(await Bun.file("module.json").text()).tests.join(" "))'); do
  echo "Chrona module test: $test"
  CHRONA_MODULE="$PWD" CHRONA_DATA="$(mktemp -d)" CHRONA_CONTENT="$(mktemp -d)" timeout 60 bun --no-install "$test"
done
`;

/** v2-25: `calls` is this build's calls.d.ts; `typecheck` the check Chrona runs on submissions, offered as chrona/typecheck.sh. */
export async function writeBuildHelpers(cwd: string, sdk: string, { calls, typecheck }: { calls: string; typecheck?: string }) {
  const dir = join(cwd, "chrona"), pkg = join(cwd, "node_modules", "chrona");
  await mkdir(dir, { recursive: true });
  await mkdir(join(cwd, "node_modules"), { recursive: true });
  await cp(sdk, pkg, { recursive: true });
  await chmod(join(pkg, "calls.d.ts"), 0o644).catch(() => {});
  await writeFile(join(pkg, "calls.d.ts"), calls);
  for (const file of ["package.json", "sdk.ts", "testing.ts", "preview.ts", "calls.d.ts"]) await chmod(join(pkg, file), 0o444);
  await writeFile(join(dir, "run-tests.sh"), RUN_TESTS, { mode: 0o555 });
  if (typecheck) await writeFile(join(dir, "typecheck.sh"), typecheckScript(join(typecheck, "check.ts"), pkg), { mode: 0o555 });
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const typecheckScript = (check: string, sdk: string) => String.raw`#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then echo 'Usage: chrona/typecheck.sh <moduledir>' >&2; exit 2; fi
exec bun --no-install ${quote(check)} "$1" ${quote(sdk)}
`;
