import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import { inboxProjectionQuerySchema } from "@chrona/contracts/api";

import {
  error,
  internalServerError,
  json,
  toHttpError,
} from "../../lib/http";

export function createInboxRoutes(engine: ChronaEngine) {
  return new Hono()
    .get("/inbox", zValidator("query", inboxProjectionQuerySchema), async (c) => {
      try {
        const { workspaceId } = c.req.valid("query");
        return json(c, await engine.pages.getInbox({ workspaceId }));
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return internalServerError(c, "GET /api/inbox", cause, "Failed to get inbox");
      }
    });
}
