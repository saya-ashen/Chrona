import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import { scheduleProjectionQuerySchema } from "@chrona/contracts/api";

import {
  error,
  internalServerError,
  json,
  toHttpError,
} from "../../../apps/server/src/lib/http";

export function createScheduleRoutes(engine: ChronaEngine) {
  return new Hono()
    .get("/schedule", zValidator("query", scheduleProjectionQuerySchema), async (c) => {
      try {
        const { workspaceId } = c.req.valid("query");
        return json(c, await engine.pages.getSchedule({ workspaceId }));
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return internalServerError(c, "GET /api/schedule", cause, "Failed to get schedule page");
      }
    });
}
