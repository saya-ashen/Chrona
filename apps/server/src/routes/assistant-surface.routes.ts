import { Hono } from "hono";
import type { ChronaEngine } from "@chrona/engine";
import type { AssistantActionRequest, AssistantSurfacePageType } from "@chrona/contracts";
import { getPreferredLocale } from "@chrona/i18n";

import { json } from "../lib/http";
import { getAssistantSurfaceState, requestAssistantAction } from "../../../../features/assistant-surface/server";

function parsePageType(value: string | undefined): AssistantSurfacePageType {
  if (value === "schedule" || value === "task" || value === "workbench") return value;
  return "unsupported";
}

export function createAssistantSurfaceRoutes(_engine: ChronaEngine) {
  return new Hono()
    .get("/assistant-surface", (c) => {
      const pageType = parsePageType(c.req.query("pageType"));
      const locale = getPreferredLocale(c.req.header("accept-language"));
      return json(c, getAssistantSurfaceState({ pageType, locale }));
    })
    .post("/assistant-surface/actions", async (c) => {
      const payload = await c.req.json<AssistantActionRequest>();
      const locale = getPreferredLocale(c.req.header("accept-language"));
      return json(c, requestAssistantAction(payload, locale));
    });
}
