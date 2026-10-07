import { useI18n } from "@chrona/i18n";
import { Button } from "@shared/ui";
import { workResults as wr } from "@chrona/contracts";
import type { useWorkResults } from "../hooks/use-work-results";

type State = ReturnType<typeof useWorkResults>;
export function ResultVersionNavigation({ state, locked }: { state: State; locked: boolean }) {
  const c = useI18n().messages.workResults;
  const versions = state.bundle?.versions.versions;
  return <nav aria-label={c.history} className="flex flex-wrap gap-2">
    <Button variant={state.selection === "latest" ? "default" : "outline"} disabled={locked} onClick={() => state.select("latest")}>{c.latest}</Button>
    <Button variant={state.selection === "accepted" ? "default" : "outline"} disabled={locked || !state.bundle?.view.result?.acceptedVersionId} onClick={() => state.select("accepted")}>{c.accepted}</Button>
    {versions?.items.map((version) => <Button key={version.id} variant="outline" disabled={locked} onClick={() => state.select(`version:${version.id}`)}>{c.version} {version.version}</Button>)}
    <ResultHistoryPaging offset={state.versionOffset} nextOffset={versions?.nextOffset ?? null} disabled={state.loading} go={state.setVersionOffset} />
  </nav>;
}
function ResultHistoryPaging({ offset, nextOffset, disabled, go }: { offset: number; nextOffset: number | null; disabled: boolean; go: (offset: number) => void }) {
  const c = useI18n().messages.workResults;
  return <>{offset > 0 && <Button variant="outline" disabled={disabled} onClick={() => go(0)}>{c.previous}</Button>}
    {nextOffset !== null && <Button variant="outline" disabled={disabled} onClick={() => go(nextOffset)}>{c.next}</Button>}</>;
}
export function ResultReviewHistory({ reviews, state }: { reviews: wr.WorkResultReviews; state: State }) {
  const c = useI18n().messages.workResults, page = reviews.reviews;
  return <section aria-label={c.reviews} className="space-y-2 break-words [overflow-wrap:anywhere]"><h2 className="font-semibold">{c.reviews}</h2>
    {!page?.items.length && <p>{c.noReviews}</p>}
    {page?.items.map((review) => <article key={review.id}><p className="text-sm">{c[review.decision as "accept" | "request_changes" | "reject"]} · {review.actorKey} · {review.createdAt}</p><p className="whitespace-pre-wrap">{review.feedback}</p></article>)}
    <div className="flex gap-2"><ResultHistoryPaging offset={state.reviewOffset} nextOffset={page?.nextOffset ?? null} disabled={state.loading} go={state.setReviewOffset} /></div>
  </section>;
}
