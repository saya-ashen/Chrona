import { compileModuleOutput } from "@chrona/contracts/steward";
import type { DeliveryStage } from "./module-supervisor-state";
import type { RoutedTool, Tool } from "./module-call-types";
import type { SystemTool } from "./module-system-types";
import { parseInput, StewardError } from "../errors";
import { validateToolArgs } from "./module-tool-contract";
import { CallError, publicCallError, publicCallReason, type CallErrorCode } from "./module-call-error";

/** A system module's errors as call errors: its own refusals keep their code. */
export function systemError(error: unknown) {
  if (error instanceof CallError) return new CallError(publicCallError(error.code), error.message, publicCallReason(error.reason ?? error.code));
  if (error instanceof StewardError) return new CallError(publicCallError(error.code), error.message, publicCallReason(error.code));
  return new CallError("unknown", message(error));
}

/** A system output mismatch leaves the outcome unknown: its handler may already have committed effects. */
export function checkSystemOutput(target: string, tool: SystemTool, output: unknown) {
  const result = tool.output?.safeParse(output);
  if (!result || result.success) return;
  const issues = result.error.issues.slice(0, 5).map(issue => `${issue.path.join(".")}: ${issue.message}`);
  throw new CallError("unknown", `${target} output does not match its declared output: ${issues.join("; ")}`);
}
export function moduleOutputError(target: string, tool: RoutedTool, output: unknown) {
  try { checkModuleOutput(target, tool, output); return null; }
  catch (error) { return message(error); }
}
export function checkModuleOutput(target: string, tool: RoutedTool, output: unknown) {
  if (!tool.output) return;
  const result = compileModuleOutput(tool.output as Record<string, unknown>).safeParse(output);
  if (result.success) return;
  const issues = result.error.issues.slice(0, 5).map(issue => {
    const path = issue.path.map(part => typeof part === "number" ? String(part) : String(part).replace(/[^A-Za-z0-9_$-]/g, "?").slice(0, 40)).join(".").slice(0, 120) || "$";
    return `${path} (${issue.code})`;
  });
  const error = new CallError("failed", `${target}: output contract mismatch${issues.length ? `: ${issues.join("; ")}` : ""}`) as CallError & { diagnosticIssues: string[] };
  error.diagnosticIssues = issues;
  throw error;
}
export function validArgs(tool: RoutedTool, raw: unknown) {
  try { return (tool as SystemTool).input ? parseInput((tool as SystemTool).input!, raw) as Record<string, unknown> : validateToolArgs(tool as Tool, raw); }
  catch (error) { throw new CallError("invalid", error instanceof StewardError ? error.message : "Invalid call arguments"); }
}

/** Maps a failed delivery: never reached the target, the target answered with an error, or lost after it was sent. */
export const stageOf = (error: unknown): DeliveryStage => (error as { stage?: DeliveryStage } | null)?.stage ?? "lost";
export const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 2000);

/** Persist the same public error classification for sync and async system calls. */
export function systemFailureData(failure: CallError, quiet = false) {
  return {
    status: failure.code === "unknown" ? "unknown" : "failed",
    error: quiet ? failure.code : `${failure.code}: ${failure.message}`.slice(0, 2000),
    errorCode: publicCallError(failure.code),
    errorReason: failure.reason ?? null,
  };
}

export function deliveryErrorCode(error: unknown) {
  const stage = stageOf(error);
  if (stage === "unavailable") return error instanceof CallError && (error.code === "conflict" || error.code === "cycle") ? error.code : "unavailable";
  if (stage === "handler") return (error as { code?: CallErrorCode }).code ?? "failed";
  return "unknown";
}
