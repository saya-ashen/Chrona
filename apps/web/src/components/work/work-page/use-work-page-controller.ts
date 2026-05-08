"use client";

import { useState } from "react";
import type { WorkbenchCopy, WorkPageData } from "./work-page-types";
import { useWorkPageActions } from "./use-work-page-actions";
import { useWorkPageProjectionState } from "./use-work-page-projection-state";

export function useWorkPageController(
  initialData: WorkPageData,
  copy: WorkbenchCopy,
) {
  const [heroErrorMessage, setHeroErrorMessage] = useState<string | null>(null);
  const [resultErrorMessage, setResultErrorMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const {
    data,
    setData,
    composerResetKey,
    refresh,
    resetComposer,
    beginRefreshEpoch,
  } = useWorkPageProjectionState(initialData, copy, isPending);
  const {
    submitWorkbenchInput,
    actions,
  } = useWorkPageActions({
    data,
    copy,
    refresh,
    resetComposer,
    beginRefreshEpoch,
    isPending,
    setIsPending,
    heroErrorMessage,
    setHeroErrorMessage,
    resultErrorMessage,
    setResultErrorMessage,
  });

  return {
    data,
    setData,

    isPending,
    heroErrorMessage,
    resultErrorMessage,
    composerResetKey,

    setHeroErrorMessage,
    setResultErrorMessage,

    refresh,
    resetComposer,
    submitWorkbenchInput,
    actions,
  };
}
