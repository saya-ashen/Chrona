import type { FinalizedResult } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n";
import { Badge } from "@shared/ui";

/** Runtime provenance, never supplied by the AI-authored result spec. */
export function TaskResultPublicationNotice({ review }: { review?: FinalizedResult["review"] }) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const label = review?.status === "completed" ? copy.resultReviewCompleted
    : review?.status === "fallback" ? copy.resultReviewFallback
    : review?.status === "pending" ? copy.resultReviewPending : copy.resultReviewUnknown;
  const detail = review?.status === "fallback"
    ? review.reason === "timeout" ? copy.resultReviewTimeout : copy.resultReviewUnavailable
    : copy.resultReviewNotFactCheck;
  return (
    <div data-ui-surface-kind="runtime-control" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" role="note">
      <Badge variant="outline">{copy.resultStructureValidated}</Badge>
      <details open={review?.status === "fallback"}>
        <summary className="cursor-pointer">{label}</summary>
        <p className="mt-1 max-w-prose">{detail}</p>
      </details>
    </div>
  );
}
