import { useCallback, useEffect, useReducer } from "react";
import {
  continueFromTaskResult,
  getTaskResultFollowUpState,
} from "../model/task-actions-client";
import {
  initialTaskResultFollowUpState,
  reduceTaskResultFollowUpState,
  type ResultFollowUpMode,
} from "../model/task-result-follow-up-state";

export function useTaskResultFollowUp(taskId: string, enabled: boolean) {
  const [state, dispatch] = useReducer(
    reduceTaskResultFollowUpState,
    initialTaskResultFollowUpState,
  );

  const load = useCallback(async () => {
    if (!enabled) return;
    dispatch({ type: "load_started" });
    try {
      dispatch({
        type: "load_succeeded",
        state: await getTaskResultFollowUpState({ taskId }),
      });
    } catch (cause) {
      dispatch({
        type: "load_failed",
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, [enabled, taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setMode = useCallback((mode: ResultFollowUpMode) => {
    dispatch({ type: "mode_changed", mode });
  }, []);

  const setDraft = useCallback((mode: ResultFollowUpMode, value: string) => {
    dispatch({ type: "draft_changed", mode, value });
  }, []);

  const submit = useCallback(async (options?: {
    sessionStrategy?: "fork_source_session" | "fresh_with_result";
  }) => {
    if (state.status === "submitting") return;
    const instruction = (
      state.mode === "ask" ? state.askDraft : state.createTaskDraft
    ).trim();
    if (!instruction) return;
    dispatch({ type: "submit_started" });
    try {
      const entry = await continueFromTaskResult({
        taskId,
        requestId: crypto.randomUUID(),
        intent: state.mode,
        instruction,
        ...(state.mode === "create_task"
          ? {
              sessionStrategy:
                options?.sessionStrategy ?? "fork_source_session",
            }
          : {}),
      });
      dispatch({ type: "submit_succeeded", entry });
      return entry;
    } catch (cause) {
      dispatch({
        type: "submit_failed",
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, [state, taskId]);

  return { state, setMode, setDraft, submit, reload: load };
}
