import { useCallback, useEffect, useState } from "react";
import { errorKind, loadResults, type ResultBundle, type ResultScope, type Selection } from "../model/client";

export function useWorkResults(scope: ResultScope) {
  const [selection, setSelection] = useState<Selection>("latest");
  const [versionOffset, setVersionOffset] = useState(0), [reviewOffset, setReviewOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [bundle, setBundle] = useState<ResultBundle | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<ReturnType<typeof errorKind> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    void loadResults({ taskId: scope.taskId, occurrenceId: scope.occurrenceId }, selection, versionOffset, reviewOffset, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setBundle(data); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorKind(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [scope.taskId, scope.occurrenceId, selection, versionOffset, reviewOffset, reload]);
  const refresh = useCallback(() => setReload((value) => value + 1), []);
  return { bundle, loading, error, refresh, selection, select: (value: Selection) => { setSelection(value); setReviewOffset(0); }, versionOffset, setVersionOffset, reviewOffset, setReviewOffset };
}
