import { Hono } from "hono";
import type { ChronaEngine } from "@chrona/engine";
import type { AssistantActionRequest, AssistantSurfacePageType } from "@chrona/contracts";

import { json } from "../lib/http";
import { getAssistantSurfaceState, requestAssistantAction } from "../services/assistant-surface.service";

function parsePageType(value: string | undefined): AssistantSurfacePageType {
  if (value === "schedule" || value === "task" || value === "workbench") return value;
  return "unsupported";
}

export function createAssistantSurfaceRoutes(_engine: ChronaEngine) {
  return new Hono()
    .get("/assistant-surface", (c) => {
      const pageType = parsePageType(c.req.query("pageType"));
      return json(c, getAssistantSurfaceState({ pageType }));
    })
    .post("/assistant-surface/actions", async (c) => {
      const payload = await c.req.json<AssistantActionRequest>();
      return json(c, requestAssistantAction(payload));
    });
}
