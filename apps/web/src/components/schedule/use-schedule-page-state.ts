"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  SchedulePageData,
  SchedulePageProps,
  SecondaryPlanningView,
} from "@/components/schedule/schedule-page-types";
import {
  hydrateSchedulePageData,
  normalizeScheduleView,
} from "@/components/schedule/schedule-page-utils";
import { refreshScheduleProjection } from "@/components/schedule/schedule-page-actions";

type UseSchedulePageStateArgs = {
  workspaceId: string;
  data: SchedulePageProps["data"];
  selectedTaskId?: string;
  selectedView?: string;
  showNewTask?: boolean;
  actionFailedMessage: string;
  routerRefresh: () => void;
};

export function useSchedulePageState({
  workspaceId,
  data,
  selectedTaskId,
  selectedView,
  showNewTask,
  actionFailedMessage,
  routerRefresh,
}: UseSchedulePageStateArgs) {
  const hydratedData = useMemo(() => hydrateSchedulePageData(data), [data]);
  const [viewData, setViewData] = useState<SchedulePageData>(
    () => hydratedData,
  );
  const [draggedTask, setDraggedTask] = useState<{
    kind: "queue" | "scheduled";
    taskId: string;
  } | null>(null);
  const [expandedQueueTaskIds, setExpandedQueueTaskIds] = useState<string[]>(
    [],
  );
  const [localSelectedTaskId, setLocalSelectedTaskId] = useState<
    string | undefined
  >(selectedTaskId);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [secondaryView, setSecondaryView] =
    useState<SecondaryPlanningView>("queue");
  const [showNewTaskDialog, setShowNewTaskDialog] = useState(false);
  const refreshRequestIdRef = useRef(0);
  const activeView = normalizeScheduleView(selectedView);

  const refreshProjection = useCallback(async () => {
    await refreshScheduleProjection({
      workspaceId,
      setViewData: (next) => startTransition(() => setViewData(next)),
      routerRefresh,
      actionFailedMessage,
      requestIdRef: refreshRequestIdRef,
    });
  }, [actionFailedMessage, routerRefresh, workspaceId]);

  useEffect(() => {
    setViewData(hydratedData);
  }, [hydratedData]);

  useEffect(() => {
    setLocalSelectedTaskId(selectedTaskId);
  }, [selectedTaskId]);

  useEffect(() => {
    setSecondaryView((current) => {
      if (current === "queue" && viewData.unscheduled.length > 0)
        return current;
      if (current === "risks" && viewData.risks.length > 0) return current;
      if (current === "proposals" && viewData.proposals.length > 0)
        return current;
      if (viewData.risks.length > 0) return "risks";
      if (viewData.unscheduled.length > 0) return "queue";
      if (viewData.proposals.length > 0) return "proposals";
      return "queue";
    });
  }, [
    viewData.proposals.length,
    viewData.risks.length,
    viewData.unscheduled.length,
  ]);

  useEffect(() => {
    if (showNewTask) {
      setShowNewTaskDialog(true);
    }
  }, [showNewTask]);

  return {
    hydratedData,
    viewData,
    setViewData,
    draggedTask,
    setDraggedTask,
    expandedQueueTaskIds,
    setExpandedQueueTaskIds,
    localSelectedTaskId,
    setLocalSelectedTaskId,
    errorMessage,
    setErrorMessage,
    announcement,
    setAnnouncement,
    isPending,
    setIsPending,
    secondaryView,
    setSecondaryView,
    showNewTaskDialog,
    setShowNewTaskDialog,
    activeView,
    refreshProjection,
  };
}
