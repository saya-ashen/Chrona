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
  provideInput,
  rejectApproval,
  reopenTask,
  retryRun,
  sendOperatorMessage,
  startRun,
} from "@/lib/task-actions-client";
import { useAppRouter } from "@/lib/router";
import type { WorkbenchCopy, WorkPageData } from "./work-page-types";
import { parseDateInputForSubmission } from "./work-page-formatters";

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
        const response = await fetch(
          `/api/work/${data.taskShell.id}/projection`,
          {
            cache: "no-store",
          },
        );

        if (!response.ok) {
          throw new Error(copy.actionFailed);
        }

        const next = (await response.json()) as WorkPageData;

        if (epoch !== refreshEpochRef.current) {
          return true;
        }

        startTransition(() =>
          setData((current) => ({
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
    if (
      isPending ||
      !data.currentRun ||
      !["Running", "WaitingForInput", "WaitingForApproval"].includes(
        data.currentRun.status,
      )
    ) {
      return;
    }

    const intervalMs = Number(
      process.env.VITE_WORK_POLL_INTERVAL_MS ??
        process.env.NEXT_PUBLIC_WORK_POLL_INTERVAL_MS ??
        10000,
    );

    const interval = window.setInterval(() => {
      void refresh({ silent: true });
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [data.currentRun, isPending, refresh]);

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
        const currentRun = data.currentRun;

        if (!currentRun) {
          await startRun({
            taskId: data.taskShell.id,
            prompt: inputText,
          });
          return;
        }

        if (currentRun.status === "WaitingForInput") {
          await provideInput({
            taskId: data.taskShell.id,
            runId: currentRun.id,
            inputText,
          });
          return;
        }

        if (
          currentRun.status === "Running" ||
          currentRun.status === "WaitingForApproval"
        ) {
          await sendOperatorMessage({
            taskId: data.taskShell.id,
            runId: currentRun.id,
            message: inputText,
          });
          return;
        }

        if (
          currentRun.status === "Completed" ||
          currentRun.status === "Failed" ||
          currentRun.status === "Cancelled"
        ) {
          await retryRun({
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
      data.currentRun,
      data.taskShell.id,
      resetComposer,
      runScopedAction,
    ],
  );

  const actions = {
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
        await retryRun({
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
