import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import { dashboardProjectionQuerySchema } from "@chrona/contracts/api";

import {
  error,
  internalServerError,
  json,
  toHttpError,
} from "../../lib/http";

export function createDashboardRoutes(engine: ChronaEngine) {
  return new Hono()
    .get("/dashboard", zValidator("query", dashboardProjectionQuerySchema), async (c) => {
      try {
        const { workspaceId } = c.req.valid("query");
        return json(c, await engine.pages.getDashboard({ workspaceId }));
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return internalServerError(c, "GET /api/dashboard", cause, "Failed to get dashboard");
      }
    });
}
