import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import {
  startWithChronaPreferenceBodySchema,
  startWithChronaPreferenceParamSchema,
  workspaceOverviewParamSchema,
} from "@chrona/contracts/api";

import { internalServerError, json } from "../lib/http";

export function createWorkspacesRoutes(engine: ChronaEngine) {
  return new Hono()
    .get("/workspaces/default", async (c) => {
      try {
        return json(c, await engine.workspaces.getDefault());
      } catch (cause) {
        return internalServerError(c, "GET /api/workspaces/default", cause, "Failed to get default workspace");
      }
    })
    .get("/workspaces", async (c) => {
      try {
        return json(c, await engine.workspaces.list());
      } catch (cause) {
        return internalServerError(c, "GET /api/workspaces", cause, "Failed to get workspaces");
      }
    })
    .get("/workspaces/:workspaceId/overview", zValidator("param", workspaceOverviewParamSchema), async (c) => {
      try {
        const { workspaceId } = c.req.valid("param");
        return json(c, await engine.workspaces.getOverview({ workspaceId }));
      } catch (cause) {
        return internalServerError(c, "GET /api/workspaces/:workspaceId/overview", cause, "Failed to get workspace overview");
      }
    })
    .get("/workspaces/:workspaceId/preferences/start-with-chrona", zValidator("param", startWithChronaPreferenceParamSchema), async (c) => {
      try {
        const { workspaceId } = c.req.valid("param");
        return json(c, await engine.workspaces.getStartWithChronaPreference({ workspaceId }));
      } catch (cause) {
        return internalServerError(c, "GET /api/workspaces/:workspaceId/preferences/start-with-chrona", cause, "Failed to get workspace preference");
      }
    })
    .patch(
      "/workspaces/:workspaceId/preferences/start-with-chrona",
      zValidator("param", startWithChronaPreferenceParamSchema),
      zValidator("json", startWithChronaPreferenceBodySchema),
      async (c) => {
        try {
          const { workspaceId } = c.req.valid("param");
          const { completedAt = new Date().toISOString() } = c.req.valid("json");
          return json(c, await engine.workspaces.setStartWithChronaPreference({ workspaceId, completedAt }));
        } catch (cause) {
          return internalServerError(c, "PATCH /api/workspaces/:workspaceId/preferences/start-with-chrona", cause, "Failed to update workspace preference");
        }
      },
    );
}
