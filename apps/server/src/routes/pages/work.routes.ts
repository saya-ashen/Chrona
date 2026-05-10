import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import { workProjectionParamSchema } from "@chrona/contracts/api";

import { error, internalServerError, json, toHttpError } from "../../lib/http";

export function createWorkRoutes(engine: ChronaEngine) {
  return new Hono()
    .get("/work/:taskId", zValidator("param", workProjectionParamSchema), async (c) => {
      try {
        const { taskId } = c.req.valid("param");
        return json(c, await engine.pages.getWork({ taskId }));
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return internalServerError(c, "GET /api/work/:taskId", cause, "Failed to get work page");
      }
    });
}
