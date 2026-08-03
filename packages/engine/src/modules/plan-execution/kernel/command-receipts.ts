import { createHash } from "node:crypto";
import type { ExecutionCommand, ExecutionCommandContext, PlanExecutionResult } from "@chrona/contracts/ai";

export const EXECUTION_COMMAND_CANONICALIZER = "chrona.execution-command";
export const EXECUTION_COMMAND_CANONICALIZER_VERSION = 1;

type JsonPrimitive = string | number | boolean | null;
type CanonicalJson = JsonPrimitive | CanonicalJson[] | { [key: string]: CanonicalJson };

function canonicalJson(value: unknown): CanonicalJson {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => canonicalJson(item));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const sorted: { [key: string]: CanonicalJson } = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) sorted[key] = canonicalJson(item);
    }
    return sorted;
  }
  return String(value);
}

export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(canonicalJson(value));
}

function authorityScope(context: ExecutionCommandContext) {
  return canonicalJson({
    runId: context.runId ?? null,
    nodeAttemptId: context.nodeAttemptId ?? null,
    providerRunId: context.providerRunId ?? null,
    trigger: context.trigger ?? null,
    sessionId: context.sessionId ?? null,
    workBlockId: context.workBlockId ?? null,
    idempotencyKey: context.idempotencyKey ?? null,
    actor: context.actor ?? null,
    origin: context.origin ?? null,
  });
}

export function canonicalExecutionCommand(input: {
  command: ExecutionCommand;
  context: ExecutionCommandContext;
}) {
  return canonicalJson({
    canonicalizer: EXECUTION_COMMAND_CANONICALIZER,
    version: EXECUTION_COMMAND_CANONICALIZER_VERSION,
    command: input.command,
    authorityScope: authorityScope(input.context),
  });
}

export function executionCommandDigest(input: {
  command: ExecutionCommand;
  context: ExecutionCommandContext;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalExecutionCommand(input)))
    .digest("hex");
}

export function canonicalReceiptResult(result: PlanExecutionResult): PlanExecutionResult {
  return JSON.parse(canonicalJsonString(result)) as PlanExecutionResult;
}

const AUTHORITATIVE_COMMIT = Symbol("planExecution.authoritativeCommit");

type InternalPlanExecutionResult = PlanExecutionResult & { [AUTHORITATIVE_COMMIT]?: boolean };

export function markAuthoritativeExecutionResult(result: PlanExecutionResult): PlanExecutionResult {
  Object.defineProperty(result, AUTHORITATIVE_COMMIT, {
    value: true,
    enumerable: false,
    configurable: true,
  });
  return result;
}

export function isAuthoritativeExecutionResult(result: PlanExecutionResult): result is InternalPlanExecutionResult {
  return (result as InternalPlanExecutionResult)[AUTHORITATIVE_COMMIT] === true;
}
