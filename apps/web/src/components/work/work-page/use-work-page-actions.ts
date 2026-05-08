"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
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
import { parseDateInputForSubmission } from "./work-page-formatters";
import type { WorkbenchCopy, WorkPageData } from "./work-page-types";

type CreateFollowUpInput = {
  title: string;
  dueAtValue?: string | null;
};

type ActionScope = "hero" | "result";

type WorkPageRefresh = (options?: { silent?: boolean; epoch?: number }) => Promise<boolean>;

type UseWorkPageActionsArgs = {
  data: WorkPageData;
  copy: WorkbenchCopy;
  refresh: WorkPageRefresh;
  resetComposer: () => void;
  beginRefreshEpoch: () => number;
  isPending: boolean;
  setIsPending: Dispatch<SetStateAction<boolean>>;
  heroErrorMessage: string | null;
  setHeroErrorMessage: Dispatch<SetStateAction<string | null>>;
  resultErrorMessage: string | null;
  setResultErrorMessage: Dispatch<SetStateAction<string | null>>;
};

export function useWorkPageActions({
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
}: UseWorkPageActionsArgs) {
  const runScopedAction = useCallback(
    async (action: () => Promise<void>, scope: ActionScope) => {
      const setScopedErrorMessage =
        scope === "hero" ? setHeroErrorMessage : setResultErrorMessage;

      try {
        setIsPending(true);
        setScopedErrorMessage(null);

        const actionEpoch = beginRefreshEpoch();
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
    [beginRefreshEpoch, copy.actionFailed, refresh],
  );

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
    isPending,
    heroErrorMessage,
    resultErrorMessage,
    setHeroErrorMessage,
    setResultErrorMessage,
    submitWorkbenchInput,
    actions,
  };
}
