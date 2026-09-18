import { apiJson } from "@shared/http";
import type { WorkReceipt, WorkView, WorkSearch } from "@chrona/contracts";
export function workRequest<T>(method: "read" | "search" | "capture" | "update", input: unknown, signal?: AbortSignal) {
  return apiJson<T>(`/api/work-records/${method}`, { method: "POST", body: JSON.stringify(input), signal });
}
export const readWork = (taskId: string, offset: number, signal?: AbortSignal) => workRequest<WorkView>("read", { taskId, offset }, signal);
export const searchWork = (attentionOnly: boolean, offset: number, query: string, signal?: AbortSignal) => workRequest<WorkSearch>("search", { attentionOnly, offset, ...(query.trim() ? { query: query.trim() } : {}) }, signal);
export const writeWork = (method: "capture" | "update", input: unknown) => workRequest<WorkReceipt>(method, input);
export function workError(error: unknown): "conflict" | "forbidden" | "invalid" | "unavailable" | "error" {
  const data = error && typeof error === "object" && "data" in error ? error.data : null;
  const code = data && typeof data === "object" && "code" in data ? data.code : null;
  const kinds: Record<string, ReturnType<typeof workError>> = { REVISION_CONFLICT: "conflict", IDEMPOTENCY_CONFLICT: "conflict", FORBIDDEN: "forbidden", AUTH_REQUIRED: "forbidden", VALIDATION_ERROR: "invalid", PRECONDITION_FAILED: "unavailable" };
  return kinds[String(code)] ?? "error";
}
