"use client";

import { useState } from "react";
import type { WorkCopy, WorkPageData } from "./work-page-types";
import { useWorkPageActions } from "./use-work-page-actions";
import { useWorkPageProjectionState } from "./use-work-page-projection-state";

export function useWorkPageController(
  initialData: WorkPageData,
  copy: WorkCopy,
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
    submitWorkInput,
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
    submitWorkInput,
    actions,
  };
}
