import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  acceptTaskResult,
  createFollowUpTask,
  dispatchExecutionAction,
  markTaskDone,
  reopenTask,
  resolveApproval,
} from "@chrona/engine";
import {
  executionActionBodySchema,
  executionActionParamSchema,
  followUpBodySchema,
  followUpParamSchema,
  resolveApprovalBodySchema,
  resolveApprovalParamSchema,
  retryTaskBodySchema,
  retryTaskParamSchema,
  runTaskBodySchema,
  runTaskParamSchema,
  taskDoneParamSchema,
  taskInputBodySchema,
  taskInputParamSchema,
  taskMessageBodySchema,
  taskMessageParamSchema,
  taskReopenParamSchema,
  taskResultAcceptParamSchema,
} from "@chrona/contracts/api";

import { ensureValidDateFields, toDateOrNull } from "./helpers";
import { error, internalServerError, json } from "../lib/http";

function isNotFoundError(message: string) {
  return /not found|no longer exists|No 'Task' record|No 'Run' record/i.test(message);
}

function isBadRequestError(message: string) {
  return /title is required|Only .* can be|No accepted plan|Cannot .* work block|work block is active/i.test(message);
}

function executionErrorStatus(message: string) {
  if (isNotFoundError(message)) {
    return 404;
  }

  if (isBadRequestError(message)) {
    return 400;
  }

  return 500;
}

export function createExecutionRoutes() {
  return new Hono()
    .post(
      "/tasks/:taskId/execution/actions",
      zValidator("param", executionActionParamSchema),
      zValidator("json", executionActionBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const action = c.req.valid("json");

          return json(c, await dispatchExecutionAction({ taskId, action }));
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to dispatch execution action";
          return error(c, message, executionErrorStatus(message));
        }
      },
    )
    .post(
      "/tasks/:taskId/run",
      zValidator("param", runTaskParamSchema),
      zValidator("json", runTaskBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const { prompt } = c.req.valid("json");

          return json(
            c,
            await dispatchExecutionAction({
              taskId,
              action: { action: "start_manual", prompt },
            }),
          );
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to start execution";
          return error(c, message, executionErrorStatus(message));
        }
      },
    )
    .post(
      "/tasks/:taskId/retry",
      zValidator("param", retryTaskParamSchema),
      zValidator("json", retryTaskBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const { prompt } = c.req.valid("json");

          return json(
            c,
            await dispatchExecutionAction({
              taskId,
              action: { action: "start_manual", prompt },
            }),
          );
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to retry execution";
          return error(c, message, executionErrorStatus(message));
        }
      },
    )
    .post(
      "/tasks/:taskId/input",
      zValidator("param", taskInputParamSchema),
      zValidator("json", taskInputBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const { inputText } = c.req.valid("json");

          return json(c, await dispatchExecutionAction({ taskId, action: { action: "resume_with_input", inputText } }));
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to continue execution";
          return error(c, message, executionErrorStatus(message));
        }
      },
    )
    .post(
      "/tasks/:taskId/message",
      zValidator("param", taskMessageParamSchema),
      zValidator("json", taskMessageBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const { message } = c.req.valid("json");

          return json(c, await dispatchExecutionAction({ taskId, action: { action: "resume_after_unblock", note: message } }));
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to send execution message";
          return error(c, message, executionErrorStatus(message));
        }
      },
    )
    .post(
      "/tasks/:taskId/done",
      zValidator("param", taskDoneParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          return json(c, await markTaskDone({ taskId }));
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to mark task done";
          return error(c, message, executionErrorStatus(message));
        }
      },
    )
    .post(
      "/tasks/:taskId/reopen",
      zValidator("param", taskReopenParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          return json(c, await reopenTask({ taskId }));
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to reopen task";
          return error(c, message, executionErrorStatus(message));
        }
      },
    )
    .post(
      "/tasks/:taskId/result/accept",
      zValidator("param", taskResultAcceptParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          return json(c, await acceptTaskResult({ taskId }));
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to accept task result";
          return error(c, message, executionErrorStatus(message));
        }
      },
    )
    .post(
      "/tasks/:taskId/follow-up",
      zValidator("param", followUpParamSchema),
      zValidator("json", followUpBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const { title, dueAt, priority } = c.req.valid("json");
          const parsedDueAt = toDateOrNull(dueAt);
          ensureValidDateFields({ dueAt: parsedDueAt });

          return json(
            c,
            await createFollowUpTask({
              taskId,
              title,
              dueAt: parsedDueAt,
              priority,
            }),
            201,
          );
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to create follow-up task";
          return error(c, message, executionErrorStatus(message));
        }
      },
    )
    .post(
      "/approvals/:approvalId/resolve",
      zValidator("param", resolveApprovalParamSchema),
      zValidator("json", resolveApprovalBodySchema),
      async (c) => {
        try {
          const { approvalId } = c.req.valid("param");
          const { decision, resolutionNote, editedContent } = c.req.valid("json");

          if (
            decision !== "Approved" &&
            decision !== "Rejected" &&
            decision !== "EditedAndApproved"
          ) {
            return error(
              c,
              "decision is required and must be Approved, Rejected, or EditedAndApproved",
              400,
            );
          }

          return json(
            c,
            await resolveApproval({
              approvalId,
              decision,
              resolutionNote,
              editedContent,
            }),
          );
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to resolve approval";
          return error(c, message, executionErrorStatus(message));
        }
      },
    );
}
