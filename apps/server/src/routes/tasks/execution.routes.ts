import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import {
  executionActionBodySchema,
  executionActionParamSchema,
} from "@chrona/contracts/api";

import { error, internalServerError, json, toHttpError } from "../../lib/http";

export function createExecutionRoutes(engine: ChronaEngine) {
  return new Hono().post(
    "/tasks/:taskId/execution/actions",
    zValidator("param", executionActionParamSchema),
    zValidator("json", executionActionBodySchema),
    async (c) => {
      try {
        const { taskId } = c.req.valid("param");
        const action = c.req.valid("json");

        return json(c, await engine.tasks.execution.dispatch({ taskId, action }));
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return internalServerError(
          c,
          "POST /api/tasks/:taskId/execution/actions",
          cause,
          "Failed to dispatch execution action",
        );
      }
    },
  );
}
