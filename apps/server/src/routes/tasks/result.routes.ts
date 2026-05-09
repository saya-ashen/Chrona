import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { acceptTaskResult } from "@chrona/engine";
import { taskResultAcceptParamSchema } from "@chrona/contracts/api";

import { error, json } from "../../lib/http";

function taskResultErrorStatus(message: string) {
  if (/not found|no longer exists|No 'Task' record|No 'Run' record/i.test(message)) {
    return 404;
  }

  if (/No accepted plan|Cannot .* work block|work block is active/i.test(message)) {
    return 400;
  }

  return 500;
}

export function createTaskResultRoutes() {
  return new Hono().post(
    "/tasks/:taskId/result/accept",
    zValidator("param", taskResultAcceptParamSchema),
    async (c) => {
      try {
        const { taskId } = c.req.valid("param");
        return json(c, await acceptTaskResult({ taskId }));
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Failed to accept task result";
        return error(c, message, taskResultErrorStatus(message));
      }
    },
  );
}
