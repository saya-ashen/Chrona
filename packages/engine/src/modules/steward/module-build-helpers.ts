import { cp, chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requireDescendantStop, spawnSupervised } from "@chrona/process";
import type { ModuleCallContracts, ModuleRuntimes } from "./module-contract-types";

// Keep deadlines observable even when a child handles signals and exits successfully.
const RUN_COMMAND = String.raw`async function runCommand(argv: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const task = spawnSupervised(argv[0]!, argv.slice(1), { ...options, timeoutMs: TIMEOUT_MS });
  task.process.stdin.end();
  task.process.stdout.pipe(process.stdout, { end: false });
  task.process.stderr.pipe(process.stderr, { end: false });
  const exit = requireDescendantStop(await task.exited);
  return exit.signal || exit.stop.reason !== "exit" ? 1 : exit.code ?? 1;
}
`;

// Modules resolve the SDK from node_modules/chrona in every build subdirectory.
const RUN_TESTS = `import { spawnSupervised, requireDescendantStop, ProcessStopUnknownError } from "chrona/process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const TIMEOUT_MS = 60_000;
${RUN_COMMAND}
if (process.argv.length !== 3) { console.error("Usage: bun chrona/run-tests.ts <moduledir>"); process.exit(2); }
const moduleDir = resolve(process.argv[2]);
const manifest = await Bun.file(join(moduleDir, "module.json")).json();
for (const test of manifest.tests) {
  console.log("Chrona module test: " + test);
  const temporary = await mkdtemp(join(tmpdir(), "chrona-build-test-"));
  let code = 1, canCleanup = true;
  try {
    const data = join(temporary, "data"), content = join(temporary, "content");
    await mkdir(data); await mkdir(content);
    code = await runCommand([process.execPath, "--no-install", resolve(moduleDir, test)], {
      cwd: moduleDir,
      env: { ...process.env, CHRONA_MODULE: moduleDir, CHRONA_DATA: data, CHRONA_CONTENT: content },
    });
  } catch (error) {
    if (error instanceof ProcessStopUnknownError) canCleanup = false;
    throw error;
  } finally { if (canCleanup) await rm(temporary, { recursive: true, force: true }); }
  if (code !== 0) process.exit(code);
}
`;

/** Prepare the SDK through the external TS runtime; the engine supplies only JSON contracts. */
export async function writeBuildHelpers(cwd: string, sdk: string, { calls, typecheck, runtimes, processHelper }: { calls: ModuleCallContracts; typecheck?: string; runtimes?: ModuleRuntimes; processHelper?: string }) {
  const bun = Bun.which("bun");
  if (!typecheck || !bun) throw new Error("Build helpers require the TypeScript runtime package and bun");
  const dir = join(cwd, "chrona"), pkg = join(cwd, "node_modules", "chrona");
  await mkdir(dir, { recursive: true });
  await mkdir(join(cwd, "node_modules"), { recursive: true });
  await cp(sdk, pkg, { recursive: true });
  await chmod(join(pkg, "calls.d.ts"), 0o644).catch(() => {});
  await writeFile(join(pkg, "calls.json"), JSON.stringify(calls));
  const task = spawnSupervised(bun, ["--no-install", join(typecheck, "calls.ts"), pkg], { timeoutMs: 60_000, helperPath: processHelper });
  task.process.stdin.end();
  let stdout = "", stderr = "";
  task.process.stdout.on("data", chunk => { stdout += chunk.toString("utf8"); });
  task.process.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
  const exit = requireDescendantStop(await task.exited);
  if (exit.code !== 0 || exit.signal || exit.stop.reason !== "exit") throw new Error(`Call declarations did not finish (exit ${exit.code}): ${(stderr || stdout).slice(-500)}`);
  for (const file of ["package.json", "sdk.ts", "testing.ts", "preview.ts", "calls.json", "calls.d.ts"]) await chmod(join(pkg, file), 0o444);
  await writeFile(join(dir, "run-tests.ts"), RUN_TESTS, { mode: 0o444 });
  await writeFile(join(dir, "typecheck.ts"), typecheckScript(typecheck, pkg, runtimes), { mode: 0o444 });
}

const typecheckScript = (typecheck: string, sdk: string, runtimes?: ModuleRuntimes) => `import { spawnSupervised, requireDescendantStop, ProcessStopUnknownError } from "chrona/process";
import { chmod, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

const TIMEOUT_MS = 60_000;
${RUN_COMMAND}
if (process.argv.length !== 3) { console.error("Usage: bun chrona/typecheck.ts <moduledir>"); process.exit(2); }
const moduleDir = resolve(process.argv[2]);
const runtimes = ${JSON.stringify(runtimes?.runtimes ?? [])};
const manifest = await Bun.file(join(moduleDir, "module.json")).json();
const check = runtimes.find(runtime => runtime.extensions.includes(extname(manifest.entry)))?.check;
if (!check) { console.log(JSON.stringify({ status: "skipped", reason: "runtime has no declared check" })); process.exit(0); }
const programs = check.programs[process.platform] ?? check.programs.default;
const program = programs.map(name => Bun.which(name)).find(Boolean);
if (!program) { console.error("Type check runtime not available"); process.exit(1); }
const temporary = await mkdtemp(join(tmpdir(), "chrona-build-typecheck-"));
let code = 1, canCleanup = true;
try {
  const sdk = join(temporary, "sdk");
  await cp(${JSON.stringify(sdk)}, sdk, { recursive: true });
  await chmod(join(sdk, "calls.d.ts"), 0o644);
  const paths = { typecheck: ${JSON.stringify(typecheck)}, module: moduleDir, sdk };
  const argv = check.argv.map(arg => arg.replace(/\\{(typecheck|module|sdk)\\}/g, (_, key) => paths[key]));
  code = await runCommand([program, ...argv]);
} catch (error) {
  if (error instanceof ProcessStopUnknownError) canCleanup = false;
  throw error;
} finally { if (canCleanup) await rm(temporary, { recursive: true, force: true }); }
process.exit(code);
`;
