import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { getMemoryConsole } from "@chrona/engine";
import { memoryProjectionQuerySchema } from "@chrona/contracts/api";

import {
  error,
  internalServerError,
  json,
  toHttpError,
} from "../../lib/http";

export function createMemoryRoutes() {
  return new Hono()
    .get("/memory", zValidator("query", memoryProjectionQuerySchema), async (c) => {
      try {
        const { workspaceId } = c.req.valid("query");
        return json(c, await getMemoryConsole(workspaceId));
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return internalServerError(c, "GET /api/memory", cause, "Failed to get memory console");
      }
    });
}
