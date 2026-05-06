import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  getDefaultWorkspace,
  getInbox,
  getMemoryConsole,
  getSchedulePage,
  getWorkPage,
  getWorkspaceOverview,
  getWorkspaces,
  WorkPageTaskNotFoundError,
} from "@chrona/engine";
import {
  scheduleProjectionQuerySchema,
  inboxProjectionQuerySchema,
  memoryProjectionQuerySchema,
  workProjectionParamSchema,
  workspaceOverviewParamSchema,
} from "@chrona/contracts/api";

import {
  error,
  internalServerError,
  json,
  toHttpError,
} from "../lib/http";

export function createProjectionsRoutes() {
  return new Hono()
    .get("/schedule/projection", zValidator("query", scheduleProjectionQuerySchema), async (c) => {
      try {
        const { workspaceId } = c.req.valid("query");
        return json(c, await getSchedulePage(workspaceId));
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return internalServerError(c, "GET /api/schedule/projection", cause, "Failed to get schedule projection");
      }
    })
    .get("/inbox/projection", zValidator("query", inboxProjectionQuerySchema), async (c) => {
      try {
        const { workspaceId } = c.req.valid("query");
        return json(c, await getInbox(workspaceId));
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return internalServerError(c, "GET /api/inbox/projection", cause, "Failed to get inbox projection");
      }
    })
    .get("/memory/projection", zValidator("query", memoryProjectionQuerySchema), async (c) => {
      try {
        const { workspaceId } = c.req.valid("query");
        return json(c, await getMemoryConsole(workspaceId));
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return internalServerError(c, "GET /api/memory/projection", cause, "Failed to get memory projection");
      }
    })
    .get("/work/:taskId/projection", zValidator("param", workProjectionParamSchema), async (c) => {
      try {
        const { taskId } = c.req.valid("param");
        return json(c, await getWorkPage(taskId));
      } catch (cause) {
        if (cause instanceof WorkPageTaskNotFoundError) {
          return error(c, "Task not found", 404);
        }
        return internalServerError(c, "GET /api/work/:taskId/projection", cause, "Failed to get work projection");
      }
    })
    .get("/workspaces/default", async (c) => {
      try {
        return json(c, await getDefaultWorkspace());
      } catch (cause) {
        return internalServerError(c, "GET /api/workspaces/default", cause, "Failed to get default workspace");
      }
    })
    .get("/workspaces", async (c) => {
      try {
        return json(c, await getWorkspaces());
      } catch (cause) {
        return internalServerError(c, "GET /api/workspaces", cause, "Failed to get workspaces");
      }
    })
    .get("/workspaces/:workspaceId/overview", zValidator("param", workspaceOverviewParamSchema), async (c) => {
      try {
        const { workspaceId } = c.req.valid("param");
        return json(c, await getWorkspaceOverview(workspaceId));
      } catch (cause) {
        return internalServerError(c, "GET /api/workspaces/:workspaceId/overview", cause, "Failed to get workspace overview");
      }
    });
}
