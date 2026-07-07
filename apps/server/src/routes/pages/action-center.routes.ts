import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import { actionCenterProjectionQuerySchema } from "@chrona/contracts/api";

import {
  error,
  internalServerError,
  json,
  toHttpError,
} from "../../lib/http";

export function createActionCenterRoutes(engine: ChronaEngine) {
  return new Hono()
    .get("/inbox", zValidator("query", actionCenterProjectionQuerySchema), async (c) => {
      try {
        const { workspaceId } = c.req.valid("query");
        return json(c, await engine.pages.getActionCenter({ workspaceId }));
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return internalServerError(c, "GET /api/inbox", cause, "Failed to get action center");
      }
    });
}
