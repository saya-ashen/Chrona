import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { markTaskDone, reopenTask } from "@chrona/engine";
import {
  taskDoneParamSchema,
  taskReopenParamSchema,
} from "@chrona/contracts/api";

import { error, json } from "../../lib/http";

function taskLifecycleErrorStatus(message: string) {
  if (/not found|no longer exists|No 'Task' record/i.test(message)) {
    return 404;
  }

  if (/Only .* can be/i.test(message)) {
    return 400;
  }

  return 500;
}

export function createTaskLifecycleRoutes() {
  return new Hono()
    .post(
      "/tasks/:taskId/complete",
      zValidator("param", taskDoneParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          return json(c, await markTaskDone({ taskId }));
        } catch (cause) {
          const message =
            cause instanceof Error ? cause.message : "Failed to mark task done";
          return error(c, message, taskLifecycleErrorStatus(message));
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
          const message =
            cause instanceof Error ? cause.message : "Failed to reopen task";
          return error(c, message, taskLifecycleErrorStatus(message));
        }
      },
    );
}
