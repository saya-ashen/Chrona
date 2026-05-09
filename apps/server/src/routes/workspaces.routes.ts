import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  getDefaultWorkspace,
  getWorkspaceOverview,
  getWorkspaces,
} from "@chrona/engine";
import { workspaceOverviewParamSchema } from "@chrona/contracts/api";

import { internalServerError, json } from "../lib/http";

export function createWorkspacesRoutes() {
  return new Hono()
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
