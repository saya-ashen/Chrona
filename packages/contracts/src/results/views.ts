import type { WorkResultContent } from "./work-result";

/** JSON transport DTOs; no engine, provider or ORM types in browser consumers. */
export type WorkResultContext = {
  task: { id: string; title: string; status: string; definitionStatus: string };
  occurrenceId: string | null;
  writesEnabled: boolean; workOpen: boolean;
  canSubmit: boolean; canReview: boolean; canUpload: boolean; canDownload: boolean;
};
export type WorkResultIdentity = { id: string; taskId: string; occurrenceId: string | null; headVersionId: string | null; acceptedVersionId: string | null; editRevision: string };
export type WorkResultVersion = {
  id: string; resultId: string; version: number; parentVersionId: string | null; contentHash: string;
  sourceKind: string; actorKey: string; sourceLabel: string | null; sourceWorkId: string | null; sourceReportedAt: string | null; publishedAt: string;
};
export type WorkResultState = { current: boolean; accepted: boolean; newerVersionPending: boolean; canAcceptContent: boolean; readinessIsSourceReported: true };
export type WorkResultView = { result: WorkResultIdentity | null; version: (WorkResultVersion & { content: WorkResultContent }) | null; state?: WorkResultState; pageUnavailable?: boolean; unavailableRequiredArtifacts?: string[] };
export type WorkResultPage<T> = { items: T[]; total: number; offset: number; hasMore: boolean; nextOffset: number | null; paginationLimitReached: boolean };
export type WorkResultVersions = { result: WorkResultIdentity | null; versions?: WorkResultPage<WorkResultVersion> };
export type WorkResultReviewItem = { id: string; versionId: string; revision: number; decision: string; feedback: string | null; actorKey: string; createdAt: string };
export type WorkResultReviews = { reviews?: WorkResultPage<WorkResultReviewItem> };
