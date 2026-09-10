import { z } from "zod";
import { isEngineError } from "../../errors";

export class ManagementError extends Error {
  constructor(readonly code: string, message: string, readonly details?: Record<string, unknown>, readonly retryable = false) { super(message); this.name = "ManagementError"; }
}
export function managementFailure(error: unknown) {
  if (error instanceof ManagementError) return { schemaVersion: 1, ok: false as const, error: { code: error.code, message: error.message, details: error.details, retryable: error.retryable } };
  if (error instanceof z.ZodError) return { schemaVersion: 1, ok: false as const, error: { code: "VALIDATION_ERROR", message: "Invalid management tool input", retryable: false, details: { fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) } } };
  // Engine/provider errors may contain SQL, local paths or request bodies. Do not forward messages.
  return { schemaVersion: 1, ok: false as const, error: { code: isEngineError(error) ? "PRECONDITION_FAILED" : "INTERNAL_ERROR", message: isEngineError(error) ? "Chrona rejected this operation; read the task state and supported actions." : "Chrona could not complete this request. Retry writes with the same requestId.", retryable: !isEngineError(error) } };
}
export function managementSuccess(data: unknown) {
  const result = { schemaVersion: 1, ok: true as const, observedAt: new Date().toISOString(), data, warnings: [] };
  if (Buffer.byteLength(JSON.stringify(result)) > 131_072) throw new ManagementError("OUTPUT_TOO_LARGE", "Use a smaller page or more specific view");
  return result;
}
