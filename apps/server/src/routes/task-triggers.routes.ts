import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import {
  createTaskTriggerBodySchema,
  listTaskOccurrencesQuerySchema,
  taskOccurrenceParamSchema,
  taskTriggerActionBodySchema,
  taskTriggerParamSchema,
  updateTaskTriggerBodySchema,
} from "@chrona/contracts/api";
import { error, internalServerError, json, toHttpError } from "../lib/http";

function fail(c: Parameters<typeof error>[0], route: string, cause: unknown) {
  const mapped = toHttpError(cause);
  if (mapped) return error(c, mapped.message, mapped.status);
  return internalServerError(c, route, cause, "Task trigger operation failed");
}

export function createTaskTriggerRoutes(engine: ChronaEngine) {
  return new Hono()
    .post("/tasks/:taskId/triggers", zValidator("param", taskTriggerParamSchema.pick({ taskId: true })), zValidator("json", createTaskTriggerBodySchema), async (c) => {
      try {
        return json(c, await engine.triggers.create({ taskId: c.req.valid("param").taskId, command: c.req.valid("json") }), 201);
      } catch (cause) {
        return fail(c, "POST /api/tasks/:taskId/triggers", cause);
      }
    })
    .patch("/tasks/:taskId/triggers/:triggerId", zValidator("param", taskTriggerParamSchema), zValidator("json", updateTaskTriggerBodySchema), async (c) => {
      try {
        return json(c, await engine.triggers.update({ ...c.req.valid("param"), command: c.req.valid("json") }));
      } catch (cause) {
        return fail(c, "PATCH /api/tasks/:taskId/triggers/:triggerId", cause);
      }
    })
    .post("/tasks/:taskId/triggers/:triggerId/actions", zValidator("param", taskTriggerParamSchema), zValidator("json", taskTriggerActionBodySchema), async (c) => {
      try {
        return json(c, await engine.triggers.action({ ...c.req.valid("param"), command: c.req.valid("json") }));
      } catch (cause) {
        return fail(c, "POST /api/tasks/:taskId/triggers/:triggerId/actions", cause);
      }
    })
    .get("/tasks/:taskId/occurrences", zValidator("param", taskTriggerParamSchema.pick({ taskId: true })), zValidator("query", listTaskOccurrencesQuerySchema), async (c) => {
      try {
        return json(c, await engine.triggers.listOccurrences({ taskId: c.req.valid("param").taskId, workspaceId: c.req.valid("query").workspaceId }));
      } catch (cause) {
        return fail(c, "GET /api/tasks/:taskId/occurrences", cause);
      }
    })
    .get("/tasks/:taskId/occurrences/:occurrenceId", zValidator("param", taskOccurrenceParamSchema), async (c) => {
      try {
        return json(c, await engine.triggers.getOccurrence(c.req.valid("param")));
      } catch (cause) {
        return fail(c, "GET /api/tasks/:taskId/occurrences/:occurrenceId", cause);
      }
    });
}
