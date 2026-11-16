import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const destination = resolve(root, process.argv[2] ?? ".tmp/release-verification");
const run = (command: string[]) => Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
function output(command: string[]): string {
  const result = run(command);
  if (result.exitCode !== 0) throw new Error(`${command.join(" ")}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}
const commit = output(["git", "rev-parse", "HEAD"]);
const lockPath = resolve(root, "resources/module-git/lock.json");
const lock = await readFile(lockPath);
const suites = {
  bun: JSON.parse(output([process.execPath, "scripts/run-bun-tests.ts", "--list"])) as string[],
  api: JSON.parse(output([process.execPath, "scripts/run-api-tests.ts", "--list"])) as string[],
};
if (!suites.bun.length || !suites.api.length) throw new Error("Release verification requires both test suites");
const trackedTests = output(["git", "ls-files", "*.test.ts", "*.test.tsx", "*.browser-test.ts", "*.browser-test.tsx"]).split("\n");
const executed = new Set([...suites.bun, ...suites.api]);
const report = {
  commit,
  workingTree: output(["git", "status", "--porcelain"]),
  lintBase: process.env.LINT_RATCHET_BASE ?? commit,
  moduleLockSha256: createHash("sha256").update(lock).digest("hex"),
  modules: JSON.parse(lock.toString()).modules,
  suites,
  testsOutsideSuites: trackedTests.filter(path => !executed.has(path)),
  steps: [] as { name: string; command: string[]; exitCode: number; durationMs: number; log: string }[],
  automatedGatesPassed: false,
  manualAcceptance: "not-run",
};
const steps: [string, string[]][] = [
  ["checks", [process.execPath, "scripts/chrona.ts", "check", "all"]],
  ["lint-debt", [process.execPath, "run", "lint:warn"]],
  ["bun-tests", [process.execPath, "run", "test:bun"]],
  ["api-tests", [process.execPath, "run", "test:api"]],
  ["build", [process.execPath, "run", "build"]],
  ["smoke", [process.execPath, "run", "build:smoke"]],
];
await mkdir(destination, { recursive: true });
async function save() { await writeFile(resolve(destination, "report.json"), JSON.stringify(report, null, 2) + "\n"); }
await save();
for (const [name, command] of steps) {
  const start = performance.now();
  const log = resolve(destination, `${name}.log`);
  const descriptor = openSync(log, "w");
  let exitCode: number;
  try {
    const child = Bun.spawn(command, {
      cwd: root, env: { ...process.env, LINT_RATCHET_BASE: report.lintBase }, stdout: descriptor, stderr: descriptor,
    });
    exitCode = await child.exited;
  } finally { closeSync(descriptor); }
  report.steps.push({ name, command, exitCode, durationMs: Math.round(performance.now() - start), log });
  await save();
  console.log(`${name}: exit ${exitCode}, ${log}`);
  if (exitCode !== 0 && name !== "lint-debt") break;
}
report.automatedGatesPassed = report.steps.length === steps.length && report.steps.every(step => step.exitCode === 0 || step.name === "lint-debt");
await save();
console.log(`Test files: Bun ${suites.bun.length}, API ${suites.api.length}, outside suites ${report.testsOutsideSuites.length}`);
console.log(`Automated gates passed: ${report.automatedGatesPassed}. Full lint debt is separate; outside-suite and manual acceptance are not covered.`);
process.exitCode = report.automatedGatesPassed ? 0 : 1;
