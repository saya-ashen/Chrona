import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { getWorkPage, WorkPageTaskNotFoundError } from "@chrona/engine";
import { workProjectionParamSchema } from "@chrona/contracts/api";

import { error, internalServerError, json } from "../../lib/http";

export function createWorkRoutes() {
  return new Hono()
    .get("/work/:taskId", zValidator("param", workProjectionParamSchema), async (c) => {
      try {
        const { taskId } = c.req.valid("param");
        return json(c, await getWorkPage(taskId));
      } catch (cause) {
        if (cause instanceof WorkPageTaskNotFoundError) {
          return error(c, "Task not found", 404);
        }
        return internalServerError(c, "GET /api/work/:taskId", cause, "Failed to get work page");
      }
    });
}
