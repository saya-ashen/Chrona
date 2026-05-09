import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { dispatchExecutionAction } from "@chrona/engine";
import {
  executionActionBodySchema,
  executionActionParamSchema,
} from "@chrona/contracts/api";

import { error, json } from "../../lib/http";

function isNotFoundError(message: string) {
  return /not found|no longer exists|No 'Task' record|No 'Run' record/i.test(
    message,
  );
}

function isBadRequestError(message: string) {
  return /Only .* can be|No accepted plan|Cannot .* work block|work block is active/i.test(
    message,
  );
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
  return new Hono().post(
    "/tasks/:taskId/execution/actions",
    zValidator("param", executionActionParamSchema),
    zValidator("json", executionActionBodySchema),
    async (c) => {
      try {
        const { taskId } = c.req.valid("param");
        const action = c.req.valid("json");

        return json(c, await dispatchExecutionAction({ taskId, action }));
      } catch (cause) {
        const message =
          cause instanceof Error
            ? cause.message
            : "Failed to dispatch execution action";
        return error(c, message, executionErrorStatus(message));
      }
    },
  );
}
