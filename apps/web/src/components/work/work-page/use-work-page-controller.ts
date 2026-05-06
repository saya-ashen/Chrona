"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  acceptTaskResult,
  approveApproval,
  createFollowUpTask,
  editAndApproveApproval,
  markTaskDone,
  rejectApproval,
  reopenTask,
  retryExecution,
  sendExecutionMessage,
  startExecution,
  submitExecutionInput,
} from "@/lib/task-actions-client";
import { useAppRouter } from "@/lib/router";
import type { WorkbenchCopy, WorkPageData } from "./work-page-types";
import { parseDateInputForSubmission } from "./work-page-formatters";
import { api } from "@/lib/rpc-client";

type RefreshOptions = {
  silent?: boolean;
  epoch?: number;
};

type CreateFollowUpInput = {
  title: string;
  dueAtValue?: string | null;
};

type ActionScope = "hero" | "result";

export function useWorkPageController(
  initialData: WorkPageData,
  copy: WorkbenchCopy,
) {
  const normalizedInitialData = {
    ...initialData,
    composerValue: initialData.composerValue ?? "",
  };
  const router = useAppRouter();

  const [data, setData] = useState<WorkPageData>(normalizedInitialData);
  const [heroErrorMessage, setHeroErrorMessage] = useState<string | null>(null);
  const [resultErrorMessage, setResultErrorMessage] = useState<string | null>(
    null,
  );
  const [isPending, setIsPending] = useState(false);
  const [composerResetKey, setComposerResetKey] = useState(0);

  const refreshEpochRef = useRef(0);
  const composerValueRef = useRef(normalizedInitialData.composerValue);

  useEffect(() => {
    composerValueRef.current = data.composerValue ?? "";
  }, [data.composerValue]);

  const refresh = useCallback(
    async ({
      silent = false,
      epoch = refreshEpochRef.current,
    }: RefreshOptions = {}) => {
      try {
        const response = await api.work[":taskId"].projection.$get({
          param: { taskId: data.taskShell.id },
        });

        if (!response.ok) {
          throw new Error(copy.actionFailed);
        }

        const next = (await response.json()) as WorkPageData;

        if (epoch !== refreshEpochRef.current) {
          return true;
        }

        startTransition(() =>
          setData(() => ({
            ...next,
            composerValue: composerValueRef.current,
          })),
        );
        return true;
      } catch (error) {
        if (silent) {
          return false;
        }

        router.refresh();
        throw error instanceof Error ? error : new Error(copy.actionFailed);
      }
    },
    [copy.actionFailed, data.taskShell.id, router],
  );

  const runScopedAction = useCallback(
    async (action: () => Promise<void>, scope: ActionScope) => {
      const setScopedErrorMessage =
        scope === "hero" ? setHeroErrorMessage : setResultErrorMessage;

      try {
        setIsPending(true);
        setScopedErrorMessage(null);

        const actionEpoch = ++refreshEpochRef.current;
        await action();
        await refresh({ epoch: actionEpoch });

        return true;
      } catch (error) {
        setScopedErrorMessage(
          error instanceof Error ? error.message : copy.actionFailed,
        );
        return false;
      } finally {
        setIsPending(false);
      }
    },
    [copy.actionFailed, refresh],
  );

  useEffect(() => {
    const planExecutionActive = data.planExecution
      ? ["running", "started", "waiting_for_user", "waiting_for_approval", "blocked"].includes(
          data.planExecution.status,
        )
      : false;

    const runActive =
      data.currentRun &&
      ["Running", "WaitingForInput", "WaitingForApproval"].includes(
        data.currentRun.status,
      );

    if (isPending || (!planExecutionActive && !runActive)) {
      return;
    }

    const intervalMs = Number(
      import.meta.env.VITE_WORK_POLL_INTERVAL_MS ?? 10000,
    );

    const interval = window.setInterval(() => {
      void refresh({ silent: true });
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [data.currentRun, data.planExecution, isPending, refresh]);

  const resetComposer = useCallback(() => {
    composerValueRef.current = "";
    setData((current) => ({ ...current, composerValue: "" }));
    setComposerResetKey((value) => value + 1);
  }, []);

  const submitWorkbenchInput = useCallback(
    async (rawInputText: string) => {
      const inputText = rawInputText.trim();

      if (!inputText) {
        setHeroErrorMessage(copy.composerRequired);
        return false;
      }

      const didSucceed = await runScopedAction(async () => {
        const planExecution = data.planExecution;

        if (!planExecution) {
          throw new Error("Execution state is unavailable. Refresh the work page and try again.");
        }

        if (planExecution.status === "no_plan") {
          throw new Error("No accepted plan. Create or accept a plan before execution.");
        }

        if (planExecution.status === "completed") {
          throw new Error("Plan execution is complete. Reopen or create a follow-up task.");
        }

        if (
          planExecution.status === "waiting_for_user" ||
          planExecution.status === "waiting_for_approval" ||
          planExecution.status === "blocked"
        ) {
          await submitExecutionInput({
            taskId: data.taskShell.id,
            inputText,
          });
          return;
        }

        if (planExecution.status === "running") {
          await sendExecutionMessage({
            taskId: data.taskShell.id,
            message: inputText,
          });
          return;
        }

        if (planExecution.status === "started") {
          await startExecution({
            taskId: data.taskShell.id,
            prompt: inputText,
          });
          return;
        }

        throw new Error(copy.currentRunCannotAcceptMessages);
      }, "hero");

      if (didSucceed) {
        resetComposer();
      }

      return didSucceed;
    },
    [
        copy.composerRequired,
        copy.currentRunCannotAcceptMessages,
        data.planExecution,
        data.taskShell.id,
        resetComposer,
        runScopedAction,
    ],
  );

  const actions = {
    async startExecution() {
      return runScopedAction(async () => {
        await startExecution({
          taskId: data.taskShell.id,
        });
      }, "hero");
    },

    async approveApproval(approvalId: string) {
      return runScopedAction(async () => {
        await approveApproval(approvalId);
      }, "hero");
    },

    async rejectApproval(approvalId: string) {
      return runScopedAction(async () => {
        await rejectApproval(approvalId);
      }, "hero");
    },

    async editAndApproveApproval(formData: FormData) {
      return runScopedAction(async () => {
        await editAndApproveApproval(formData);
      }, "hero");
    },

    async acceptResult() {
      return runScopedAction(async () => {
        await acceptTaskResult({ taskId: data.taskShell.id });
      }, "result");
    },

    async retryResult(prompt?: string) {
      return runScopedAction(async () => {
        await retryExecution({
          taskId: data.taskShell.id,
          prompt:
            prompt?.trim() ||
            data.taskShell.prompt ||
            `${copy.continueProcessingPrefix}${data.taskShell.title}`,
        });
      }, "result");
    },

    async markTaskDone() {
      return runScopedAction(async () => {
        await markTaskDone({ taskId: data.taskShell.id });
      }, "result");
    },

    async reopenTask() {
      return runScopedAction(async () => {
        await reopenTask({ taskId: data.taskShell.id });
      }, "result");
    },

    async createFollowUpTask(input: CreateFollowUpInput) {
      const title = input.title.trim();
      const dueAtValue = input.dueAtValue?.trim() ?? "";

      return runScopedAction(async () => {
        if (!title) {
          throw new Error(copy.invalidFollowUpTitle);
        }

        const dueAt = (() => {
          if (!dueAtValue) {
            return null;
          }

          const parsedDueAt = parseDateInputForSubmission(dueAtValue);

          if (!parsedDueAt) {
            throw new Error(copy.invalidFollowUpDate);
          }

          return parsedDueAt;
        })();

        await createFollowUpTask({
          taskId: data.taskShell.id,
          title,
          dueAt,
        });
      }, "result");
    },
  };

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
