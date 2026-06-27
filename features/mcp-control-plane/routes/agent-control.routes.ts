import { Hono } from "hono";
import { z } from "zod";
import { handleControlAction, ControlRouteError, validateRunToken } from "@chrona/engine";
import { agentControlActionBodySchema } from "@chrona/contracts/api";
import { error, internalServerError, json } from "../../../apps/server/src/lib/http";

const controlRequestSchema = z.object({
  body: agentControlActionBodySchema,
});

function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]!.trim() : null;
}

export function createAgentControlRoutes() {
  return new Hono().post("/agent/control", async (c) => {
    const token = extractBearerToken(c.req.header("authorization"));
    if (!token) return error(c, "Missing or malformed Authorization header", 401);

    let parsed: { body: z.infer<typeof agentControlActionBodySchema> };
    try {
      const raw = await c.req.json();
      parsed = controlRequestSchema.parse(raw);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Invalid request body";
      return error(c, message, 400);
    }

    try {
      const scope = await validateRunToken(token);
      if (!scope) {
        return error(c, "Invalid or expired run token", 401);
      }
      const outcome = await handleControlAction({
        token,
        body: parsed.body,
        workspaceId: scope.workspaceId,
      });
      return json(c, {
        ok: true,
        kind: outcome.kind,
        recorded: outcome.recorded,
        result: outcome.result,
      });
    } catch (cause) {
      if (cause instanceof ControlRouteError) {
        return error(c, cause.message, cause.status);
      }
      return internalServerError(c, "POST /agent/control", cause, "Failed to handle agent control action");
    }
  });
}
