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

export async function writeBuildHelpers(cwd: string, sdk: string) {
  const dir = join(cwd, "chrona"), pkg = join(cwd, "node_modules", "chrona");
  await mkdir(dir, { recursive: true });
  await mkdir(join(cwd, "node_modules"), { recursive: true });
  await cp(sdk, pkg, { recursive: true });
  for (const file of ["package.json", "sdk.ts", "testing.ts"]) await chmod(join(pkg, file), 0o444);
  await writeFile(join(dir, "run-tests.sh"), RUN_TESTS, { mode: 0o555 });
}
