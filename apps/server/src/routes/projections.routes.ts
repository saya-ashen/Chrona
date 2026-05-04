import { Hono } from "hono";

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
  error,
  internalServerError,
  json,
  requireQuery,
  toHttpError,
} from "../lib/http";

export function createProjectionsRoutes() {
  const api = new Hono();

  api.get("/schedule/projection", async (c) => {
    try {
      return json(c, await getSchedulePage(requireQuery(c, "workspaceId")));
    } catch (cause) {
      const httpError = toHttpError(cause);
      if (httpError) {
        return error(c, httpError.message, httpError.status);
      }
      return internalServerError(c, "GET /api/schedule/projection", cause, "Failed to get schedule projection");
    }
  });

  api.get("/inbox/projection", async (c) => {
    try {
      return json(c, await getInbox(requireQuery(c, "workspaceId")));
    } catch (cause) {
      const httpError = toHttpError(cause);
      if (httpError) {
        return error(c, httpError.message, httpError.status);
      }
      return internalServerError(c, "GET /api/inbox/projection", cause, "Failed to get inbox projection");
    }
  });

  api.get("/memory/projection", async (c) => {
    try {
      return json(c, await getMemoryConsole(requireQuery(c, "workspaceId")));
    } catch (cause) {
      const httpError = toHttpError(cause);
      if (httpError) {
        return error(c, httpError.message, httpError.status);
      }
      return internalServerError(c, "GET /api/memory/projection", cause, "Failed to get memory projection");
    }
  });

  api.get("/work/:taskId/projection", async (c) => {
    try {
      return json(c, await getWorkPage(c.req.param("taskId")));
    } catch (cause) {
      if (cause instanceof WorkPageTaskNotFoundError) {
        return error(c, "Task not found", 404);
      }
      return internalServerError(c, "GET /api/work/:taskId/projection", cause, "Failed to get work projection");
    }
  });

  api.get("/workspaces/default", async (c) => {
    try {
      return json(c, await getDefaultWorkspace());
    } catch (cause) {
      return internalServerError(c, "GET /api/workspaces/default", cause, "Failed to get default workspace");
    }
  });

  api.get("/workspaces", async (c) => {
    try {
      return json(c, await getWorkspaces());
    } catch (cause) {
      return internalServerError(c, "GET /api/workspaces", cause, "Failed to get workspaces");
    }
  });

  api.get("/workspaces/:workspaceId/overview", async (c) => {
    try {
      return json(c, await getWorkspaceOverview(c.req.param("workspaceId")));
    } catch (cause) {
      return internalServerError(c, "GET /api/workspaces/:workspaceId/overview", cause, "Failed to get workspace overview");
    }
  });

  return api;
}
