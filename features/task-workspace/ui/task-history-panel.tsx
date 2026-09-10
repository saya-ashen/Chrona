import { useInfiniteQuery } from "@tanstack/react-query";
import { useI18n } from "@chrona/i18n";
import { Button } from "@shared/ui";
import { loadWorkspaceActivityPage } from "../model/task-workspace-actions";
import { ActivityTimeline } from "./activity-timeline";

/** Reads the existing bounded public activity endpoint; no raw provider payloads. */
export function TaskHistoryPanel({ taskId }: { taskId: string }) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const history = useInfiniteQuery({
    queryKey: ["task-history", taskId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => loadWorkspaceActivityPage({ taskId, cursor: pageParam, limit: 30 }),
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  });
  const items = history.data?.pages.flatMap(page => page.items) ?? [];
  return (
    <section className="space-y-3 p-3" aria-label={copy.historyTab} data-ui-surface-kind="product-authored">
      <p className="text-xs text-muted-foreground">{copy.historyScope}</p>
      {history.isPending ? <p role="status">{copy.historyLoading}</p> : null}
      {history.isError ? <div role="alert"><p>{copy.historyError}</p><Button variant="outline" size="sm" onClick={() => void (items.length ? history.fetchNextPage() : history.refetch())}>{copy.historyRetry}</Button></div> : null}
      {!history.isPending && !history.isError && !items.length ? <p>{copy.historyEmpty}</p> : null}
      <ActivityTimeline items={items} density="compact" />
      {history.hasNextPage ? <Button variant="outline" size="sm" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>{history.isFetchingNextPage ? copy.historyLoading : copy.historyMore}</Button> : null}
    </section>
  );
}
