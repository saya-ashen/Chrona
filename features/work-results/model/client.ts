import { workResults as wr } from "@chrona/contracts";
import { apiJson } from "@shared/http";

export type ResultScope = { taskId: string; occurrenceId: string | null };
export type Selection = "latest" | "accepted" | `version:${string}`;
export function selectionInput(selection: Selection) {
  return selection.startsWith("version:") ? { selection: "version", versionId: selection.slice(8) } : { selection };
}
export function resultRequest<T>(method: "context" | "read" | "submit" | "review" | "file", input: unknown, signal?: AbortSignal) {
  return apiJson<T>(`/api/results/${method}`, { method: "POST", body: JSON.stringify(input), signal });
}
export function errorKind(error: unknown): "conflict" | "forbidden" | "invalid" | "error" {
  const data = error && typeof error === "object" && "data" in error ? error.data : null;
  const code = data && typeof data === "object" && "code" in data ? data.code : null;
  if (code === "REVISION_CONFLICT" || code === "IDEMPOTENCY_CONFLICT") return "conflict";
  if (code === "AUTH_REQUIRED" || code === "FORBIDDEN") return "forbidden";
  return code === "VALIDATION_ERROR" ? "invalid" : "error";
}
export type ResultBundle = { context: wr.WorkResultContext; view: wr.WorkResultView; versions: wr.WorkResultVersions; reviews: wr.WorkResultReviews };
export async function loadResults(scope: ResultScope, selection: Selection, versionOffset: number, reviewOffset: number, signal?: AbortSignal): Promise<ResultBundle> {
  const [context, view, versions] = await Promise.all([
    resultRequest<wr.WorkResultContext>("context", scope, signal),
    resultRequest<wr.WorkResultView>("read", { ...scope, ...selectionInput(selection) }, signal),
    resultRequest<wr.WorkResultVersions>("read", { ...scope, view: "versions", offset: versionOffset }, signal),
  ]);
  const reviews = view.version ? await resultRequest<wr.WorkResultReviews>("read", { ...scope, selection: "version", versionId: view.version.id, view: "reviews", offset: reviewOffset }, signal) : {};
  return { context, view, versions, reviews };
}
