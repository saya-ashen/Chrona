import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { CalendarFeedTransport } from "@chrona/integrations";
import { startAutoPlanGenerationForTask } from "@chrona/engine";
import {
  createCalendarSourceRequestSchema,
  refreshCalendarSourceRequestSchema,
  updateCalendarSourceRequestSchema,
  validateCalendarSourceRequestSchema,
} from "@chrona/contracts";

import { error, internalServerError, json } from "../lib/http";
import { createExternalCalendarService } from "../services/external-calendar-service";

export type CalendarSourceRouteOptions = {
  transport?: CalendarFeedTransport;
  now?: () => Date;
};

const workspaceParamSchema = z.object({ workspaceId: z.string().min(1) });
const sourceParamSchema = workspaceParamSchema.extend({ sourceId: z.string().min(1) });
const eventQuerySchema = z.object({
  from: z.string().datetime().or(z.string().date()),
  to: z.string().datetime().or(z.string().date()),
  sourceId: z.string().optional(),
});

function parseDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function createE2eCalendarFixtureTransport(): CalendarFeedTransport {
  const fixture = readFileSync(resolve("packages/integrations/src/calendar/fixtures/valid.ics"), "utf8");
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname !== "calendar-fixtures.test") return { status: 404, text: "" };

    const title = parsed.searchParams.get("title");
    const day = parsed.searchParams.get("day");
    let text = title ? fixture.replace("SUMMARY:External standup", `SUMMARY:${title}`) : fixture;
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
      const compactDay = day.replaceAll("-", "");
      text = text
        .replace("DTSTART:20260504T090000Z", `DTSTART:${compactDay}T090000Z`)
        .replace("DTEND:20260504T093000Z", `DTEND:${compactDay}T093000Z`);
    }
    return { status: 200, text };
  };
}

function defaultRouteTransport() {
  return process.env.CHRONA_E2E_CALENDAR_FIXTURES === "1"
    ? createE2eCalendarFixtureTransport()
    : undefined;
}

export function createCalendarSourceRoutes(options: CalendarSourceRouteOptions = {}) {
  const service = createExternalCalendarService({
    transport: options.transport ?? defaultRouteTransport(),
    now: options.now,
    autoPlanTask: startAutoPlanGenerationForTask,
  });

  return new Hono()
    .post(
      "/workspaces/:workspaceId/calendar-sources/validate",
      zValidator("param", workspaceParamSchema),
      zValidator("json", validateCalendarSourceRequestSchema),
      async (c) => {
        try {
          const body = c.req.valid("json");
          return json(c, await service.validateSourceUrl(body.url, { allowBlockedNetwork: body.allowBlockedNetwork }));
        } catch (cause) {
          return internalServerError(c, "POST /api/workspaces/:workspaceId/calendar-sources/validate", cause, "Failed to validate calendar source");
        }
      },
    )
    .post(
      "/workspaces/:workspaceId/calendar-sources",
      zValidator("param", workspaceParamSchema),
      zValidator("json", createCalendarSourceRequestSchema),
      async (c) => {
        try {
          const { workspaceId } = c.req.valid("param");
          const result = await service.createSource(workspaceId, c.req.valid("json"));
          if ("validation" in result) return json(c, result.validation, 400);
          return json(c, result, 201);
        } catch (cause) {
          return internalServerError(c, "POST /api/workspaces/:workspaceId/calendar-sources", cause, "Failed to create calendar source");
        }
      },
    )
    .get("/workspaces/:workspaceId/calendar-sources", zValidator("param", workspaceParamSchema), async (c) => {
      try {
        const { workspaceId } = c.req.valid("param");
        return json(c, await service.listSources(workspaceId));
      } catch (cause) {
        return internalServerError(c, "GET /api/workspaces/:workspaceId/calendar-sources", cause, "Failed to list calendar sources");
      }
    })
    .patch(
      "/workspaces/:workspaceId/calendar-sources/:sourceId",
      zValidator("param", sourceParamSchema),
      zValidator("json", updateCalendarSourceRequestSchema),
      async (c) => {
        try {
          const { workspaceId, sourceId } = c.req.valid("param");
          return json(c, await service.updateSource(workspaceId, sourceId, c.req.valid("json")));
        } catch (cause) {
          if (cause instanceof Error && cause.message.includes("Record to update not found")) return error(c, "Calendar source not found", 404);
          return internalServerError(c, "PATCH /api/workspaces/:workspaceId/calendar-sources/:sourceId", cause, "Failed to update calendar source");
        }
      },
    )
    .post(
      "/workspaces/:workspaceId/calendar-sources/:sourceId/refresh",
      zValidator("param", sourceParamSchema),
      async (c) => {
      try {
        const { workspaceId, sourceId } = c.req.valid("param");
        const rawBody = await c.req.json().catch(() => undefined);
        const body = refreshCalendarSourceRequestSchema.parse(rawBody) ?? {};
        return json(c, await service.refreshSource(workspaceId, sourceId, { allowBlockedNetwork: body.allowBlockedNetwork }));
      } catch (cause) {
        if (cause instanceof Error && cause.message === "calendar_source_not_found") return error(c, "Calendar source not found", 404);
        return internalServerError(c, "POST /api/workspaces/:workspaceId/calendar-sources/:sourceId/refresh", cause, "Failed to refresh calendar source");
      }
    })
    .delete("/workspaces/:workspaceId/calendar-sources/:sourceId", zValidator("param", sourceParamSchema), async (c) => {
      try {
        const { workspaceId, sourceId } = c.req.valid("param");
        return json(c, await service.removeSource(workspaceId, sourceId));
      } catch (cause) {
        return internalServerError(c, "DELETE /api/workspaces/:workspaceId/calendar-sources/:sourceId", cause, "Failed to remove calendar source");
      }
    })
    .get(
      "/workspaces/:workspaceId/calendar-events",
      zValidator("param", workspaceParamSchema),
      zValidator("query", eventQuerySchema),
      async (c) => {
        try {
          const { workspaceId } = c.req.valid("param");
          const query = c.req.valid("query");
          const from = parseDate(query.from);
          const to = parseDate(query.to);
          if (!from || !to || from >= to) return error(c, "Provide a valid from/to date range", 400);
          return json(c, await service.listEvents(workspaceId, from, to, query.sourceId));
        } catch (cause) {
          return internalServerError(c, "GET /api/workspaces/:workspaceId/calendar-events", cause, "Failed to list calendar events");
        }
      },
    );
}
