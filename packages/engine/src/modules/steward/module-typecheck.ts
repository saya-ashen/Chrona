import { chmod, cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModuleManifest } from "@chrona/contracts/steward";
import type { ModuleContext, TypecheckReport } from "./module-context";
import { callsDeclaration } from "./module-contracts";

const TIMEOUT_MS = 60_000, MEMORY_MB = 4096;
function parseResult(stdout: string) {
  try { return JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as Pick<TypecheckReport, "errors" | "total">; }
  catch { return null; }
}
function typecheckResult(code: number, result: Pick<TypecheckReport, "errors" | "total"> | null, signal: string | null, stderr: string): TypecheckReport {
  if (code === 0 && result) return { status: "passed" };
  if (code === 1 && result?.errors) return { status: "failed", errors: result.errors, total: result.total ?? result.errors.length };
  return { status: "failed", reason: `type check did not finish (exit ${code}${signal ? `, ${signal}` : ""}): ${stderr.slice(-500)}` };
}

/**
 * v2-25 §4: the entry (and what it imports) against the SDK and this workspace's call contracts, before tests.
 * check.ts only reads files; it runs in its own process with a time and memory limit.
 */
export async function typecheckBuild(context: ModuleContext, staging: string, manifest: ModuleManifest, candidate?: { moduleName: string; manifest: ModuleManifest }): Promise<TypecheckReport> {
  const { ports } = context, check = ports.moduleTypecheck && join(ports.moduleTypecheck, "check.ts"), bun = Bun.which("bun");
  if (!/\.(ts|tsx|mts)$/.test(manifest.entry)) return { status: "skipped", reason: "entry is not TypeScript" };
  if (!check || !existsSync(check) || !ports.moduleSdk || !bun) return { status: "skipped", reason: "type check not available" };
  const sdk = await mkdtemp(join(tmpdir(), "chrona-typecheck-"));
  try {
    await cp(ports.moduleSdk, sdk, { recursive: true });
    await chmod(join(sdk, "calls.d.ts"), 0o644).catch(() => {});
    await writeFile(join(sdk, "calls.d.ts"), await callsDeclaration(ports, context.workspaceId, candidate));
    const child = Bun.spawn(["sh", "-c", 'ulimit -v "$1" || exit 125; shift; exec "$@"', "typecheck", String(MEMORY_MB * 1024), bun, "--no-install", check, staging, sdk],
      { stdout: "pipe", stderr: "pipe", timeout: TIMEOUT_MS, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return typecheckResult(code, parseResult(stdout), child.signalCode, stderr);
  } finally { await rm(sdk, { recursive: true, force: true }); }
}

/** Lines for the build report's errors, which the build conversation reads. */
export function typecheckErrors(report: TypecheckReport) {
  if (report.status !== "failed") return [];
  if (!report.errors) return [`Type check: ${report.reason}`];
  const more = (report.total ?? 0) > report.errors.length ? [`Type check: ${report.total! - report.errors.length} more errors`] : [];
  return [...report.errors.map(error => `Type check ${error.file}:${error.line} TS${error.code}: ${error.message}`.slice(0, 1000)), ...more];
}
