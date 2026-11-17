import { chmod, cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import type { ModuleManifest } from "@chrona/contracts/steward";
import { requireDescendantStop, spawnSupervised, type SupervisedExit } from "@chrona/process";
import type { ModuleContext, TypecheckReport } from "../module-context";
import { callsContracts, type ModuleRuntimes } from "../module-contracts";
import { assertBuildOwnership, holdBuildOwnership } from "./module-build-ownership";

const TIMEOUT_MS = 60_000;
function parseResult(stdout: string) {
  try { return JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as Pick<TypecheckReport, "errors" | "total">; }
  catch { return null; }
}
function typecheckResult(exit: SupervisedExit, result: Pick<TypecheckReport, "errors" | "total"> | null, stderr: string): TypecheckReport {
  const { signal } = exit, code = signal || exit.stop.reason !== "exit" ? null : exit.code;
  if (code === 0 && result) return { status: "passed" };
  if (code === 1 && result?.errors) return { status: "failed", errors: result.errors, total: result.total ?? result.errors.length };
  return { status: "failed", reason: `type check did not finish (exit ${code}${signal ? `, ${signal}` : ""}): ${stderr.slice(-500)}` };
}

/**
 * v2-25 §4: the entry (and what it imports) against the SDK and this workspace's call contracts, before tests.
 * The runtime's declared check runs in its own process with a time limit.
 */
export async function typecheckBuild(context: ModuleContext, staging: string, manifest: ModuleManifest, candidate?: { moduleName: string; manifest: ModuleManifest }): Promise<TypecheckReport> {
  assertBuildOwnership(context, staging);
  const { ports } = context;
  // The host injects the registry as data; the engine never imports a runtime implementation.
  const { moduleRuntimes } = ports as typeof ports & { moduleRuntimes?: ModuleRuntimes };
  const check = moduleRuntimes?.runtimes.find(runtime => typeof manifest.entry === "string" && runtime.extensions.includes(extname(manifest.entry)))?.check;
  if (!check) return { status: "skipped", reason: "runtime has no declared check" };
  const programs = check.programs[process.platform] ?? check.programs.default;
  const program = programs.map(name => Bun.which(name)).find(Boolean);
  if (!ports.moduleTypecheck || !existsSync(ports.moduleTypecheck) || !ports.moduleSdk || !program) return { status: "skipped", reason: "type check not available" };
  const temporary = await mkdtemp(join(tmpdir(), "chrona-typecheck-")), sdk = join(temporary, "sdk");
  let canCleanup = true;
  try {
    await cp(ports.moduleSdk, sdk, { recursive: true });
    await chmod(join(sdk, "calls.d.ts"), 0o644).catch(() => {});
    await writeFile(join(sdk, "calls.json"), JSON.stringify(await callsContracts(ports, context.workspaceId, candidate)));
    const paths: Record<string, string> = { typecheck: ports.moduleTypecheck, module: staging, sdk };
    const argv = check.argv.map(arg => arg.replace(/\{(typecheck|module|sdk)\}/g, (_, key: string) => paths[key]!));
    const task = spawnSupervised(program, argv,
      { helperPath: ports.processHelper, timeoutMs: TIMEOUT_MS, env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot } });
    canCleanup = false;
    task.process.stdin.end();
    let stdout = "", stderr = "";
    task.process.stdout.on("data", chunk => { stdout += chunk.toString("utf8"); });
    task.process.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
    const exit = requireDescendantStop(await task.exited);
    canCleanup = true;
    return typecheckResult(exit, parseResult(stdout), stderr);
  } catch (error) {
    holdBuildOwnership(context, staging, error);
    throw error;
  } finally {
    // Keep the writable SDK while a checker may still own it.
    if (canCleanup) await rm(temporary, { recursive: true, force: true });
  }
}

/** Lines for the build report's errors, which the build conversation reads. */
export function typecheckErrors(report: TypecheckReport) {
  if (report.status !== "failed") return [];
  if (!report.errors) return [`Type check: ${report.reason}`];
  const more = (report.total ?? 0) > report.errors.length ? [`Type check: ${report.total! - report.errors.length} more errors`] : [];
  return [...report.errors.map(error => `Type check ${error.file}:${error.line} TS${error.code}: ${error.message}`.slice(0, 1000)), ...more];
}
