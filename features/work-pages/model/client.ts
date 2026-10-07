import type { PageEntry, PageInputsView, PageWrite, WorkResultView } from "@chrona/contracts";
import { apiJson } from "@shared/http";
export type PageScope = { taskId: string; occurrenceId: string | null };
export function pageRequest<T>(method: "read" | "input" | "catalog" | "validate", input: unknown, signal?: AbortSignal) {
  return apiJson<T>(`/api/results/page/${method}`, { method: "POST", body: JSON.stringify(input), signal });
}
export const readPageResult = (scope: PageScope, signal?: AbortSignal) => apiJson<WorkResultView>("/api/results/read", { method: "POST", body: JSON.stringify(scope), signal });
export function pageError(error: unknown): "conflict" | "invalid" | "readOnly" | "unknown" {
  const data = error && typeof error === "object" && "data" in error ? error.data : null;
  const code = data && typeof data === "object" && "code" in data ? String(data.code) : "";
  if (code === "REVISION_CONFLICT" || code === "IDEMPOTENCY_CONFLICT") return "conflict";
  if (code === "VALIDATION_ERROR") return "invalid";
  if (["AUTH_REQUIRED", "FORBIDDEN", "PRECONDITION_FAILED", "NOT_FOUND"].includes(code)) return "readOnly";
  return "unknown";
}
export async function loadPageResponses(scope: PageScope, versionId: string, signal?: AbortSignal): Promise<PageInputsView> {
  const entries: PageEntry[] = []; let offset = 0; let revision: string | null | undefined;
  // At most 8 forms. A large individual answer may consume one transport page.
  for (let i = 0; i < 8; i++) {
    const page = await pageRequest<PageInputsView>("read", { ...scope, versionId, kind: "response", limit: 20, offset }, signal);
    if (revision !== undefined && revision !== page.revision) throw new Error("Input changed while reading");
    revision = page.revision; entries.push(...page.entries);
    if (page.nextOffset === null) return { ...page, entries };
    offset = page.nextOffset;
  }
  throw new Error("Incomplete answer read");
}
export type PageAction = PageWrite["action"];
