import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import { dashboardAiBriefGenerateBodySchema, dashboardProjectionQuerySchema } from "@chrona/contracts/api";

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
    })
    .post(
      "/pages/dashboard/ai-brief/generate",
      zValidator("query", dashboardProjectionQuerySchema),
      zValidator("json", dashboardAiBriefGenerateBodySchema),
      async (c) => {
        try {
          const { workspaceId } = c.req.valid("query");
          const { force } = c.req.valid("json");
          return json(c, await engine.pages.generateDashboardBrief({ workspaceId, force }));
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(c, "POST /api/pages/dashboard/ai-brief/generate", cause, "Failed to generate dashboard AI brief");
        }
      },
    );
}
