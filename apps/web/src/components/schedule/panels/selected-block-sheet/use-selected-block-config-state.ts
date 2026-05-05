"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScheduledItem } from "@/components/schedule/schedule-page-types";
import type {
  TaskConfigDraftState,
  TaskConfigFormDraft,
  TaskConfigFormInput,
} from "@/components/schedule/task-config-form";

function normalizePriority(value: string): TaskConfigFormDraft["priority"] {
  switch (value) {
    case "Low":
    case "Medium":
    case "High":
    case "Urgent":
      return value;
    default:
      return "Medium";
  }
}

function toPlanningTaskDraft(item: Pick<ScheduledItem, "title" | "description" | "priority" | "dueAt">): TaskConfigFormDraft {
  return {
    title: item.title,
    description: item.description ?? "",
    priority: normalizePriority(item.priority),
    dueAt: item.dueAt,
  };
}

function serializeTaskConfigDraftState(state: TaskConfigDraftState) {
  return JSON.stringify({
    isDirty: state.isDirty,
    values: {
      ...state.values,
      dueAt: state.values.dueAt?.toISOString() ?? null,
    },
  });
}

export function useSelectedBlockConfigState({
  item,
  onSaveTaskConfigAction,
}: {
  item: ScheduledItem;
  onSaveTaskConfigAction: (taskId: string, input: TaskConfigFormInput) => Promise<void>;
}) {
  const [planningTaskDraft, setPlanningTaskDraft] = useState<TaskConfigFormDraft>(() => toPlanningTaskDraft(item));
  const [taskConfigDraftState, setTaskConfigDraftState] = useState<TaskConfigDraftState | null>(null);
  const lastTaskConfigDraftStateKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const nextDraft = toPlanningTaskDraft(item);
    setPlanningTaskDraft(nextDraft);
    setTaskConfigDraftState(null);
    lastTaskConfigDraftStateKeyRef.current = null;
  }, [item.description, item.dueAt, item.priority, item.taskId, item.title]);

  const handleTaskConfigDraftStateChange = useCallback((state: TaskConfigDraftState) => {
    const nextKey = serializeTaskConfigDraftState(state);
    if (lastTaskConfigDraftStateKeyRef.current === nextKey) {
      return;
    }

    lastTaskConfigDraftStateKeyRef.current = nextKey;
    setTaskConfigDraftState(state);
  }, []);

  const saveTaskConfig = useCallback(async (input: TaskConfigFormInput) => {
    await onSaveTaskConfigAction(item.taskId, input);
    setPlanningTaskDraft({
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueAt: input.dueAt,
    });
    setTaskConfigDraftState({ isDirty: false, values: input });
  }, [item.taskId, onSaveTaskConfigAction]);

  const saveConfigBeforeRegenerate = useCallback(async () => {
    if (!taskConfigDraftState?.values) {
      return;
    }

    await saveTaskConfig(taskConfigDraftState.values);
  }, [saveTaskConfig, taskConfigDraftState?.values]);

  return {
    planningTaskDraft,
    taskConfigDraftState,
    handleTaskConfigDraftStateChange,
    saveTaskConfig,
    saveConfigBeforeRegenerate,
  };
}
