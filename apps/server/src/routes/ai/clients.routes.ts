import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import {
  createAiClientSchema,
  testAiClientSchema,
  updateAiClientParamSchema,
  updateAiClientBodySchema,
  deleteAiClientParamSchema,
  updateAiBindingsParamSchema,
  updateAiBindingsBodySchema,
} from "@chrona/contracts/api";

import { VALID_AI_FEATURES } from "../helpers";
import { error, internalServerError, json, toHttpError } from "../../lib/http";

export function createClientsRoutes(engine: ChronaEngine) {
  // ──────────────────────────────────────────────
  // AI Client Management
  // ──────────────────────────────────────────────

  return new Hono()
    .get("/ai/clients", async (c) => {
      try {
        const clients = await engine.aiClients.list();

        return json(c, {
          clients: clients.map((client) => ({
            id: client.id,
            name: client.name,
            type: client.type,
            config: client.config,
            isDefault: client.isDefault,
            enabled: client.enabled,
            bindings: client.bindings.map(
              (binding: { feature: string }) => binding.feature,
            ),
            createdAt: client.createdAt.toISOString(),
          })),
        });
      } catch (cause) {
        return internalServerError(
          c,
          "GET /api/ai/clients",
          cause,
          "Failed to list AI clients",
        );
      }
    })
    .post(
      "/ai/clients",
      zValidator("json", createAiClientSchema),
      async (c) => {
        try {
          const { name, type, config, isDefault } = c.req.valid("json");

          const client = await engine.aiClients.create({
            name,
            type,
            config: config as Record<string, unknown> | undefined,
            isDefault,
          });

          return json(c, { client }, 201);
        } catch (cause) {
          return internalServerError(
            c,
            "POST /api/ai/clients",
            cause,
            "Failed to create AI client",
          );
        }
      },
    )
    .post(
      "/ai/clients/test",
      zValidator("json", testAiClientSchema),
      async (c) => {
        try {
          const { type, config } = c.req.valid("json");

          const result = await engine.aiClients.test({
            type,
            config: (config ?? {}) as Record<string, unknown>,
          });

          return json(c, { ok: true, ...result });
        } catch (cause) {
          const message =
            cause instanceof Error ? cause.message : "Failed to test client";
          return json(
            c,
            { ok: false, available: false, reason: message, error: message },
            500,
          );
        }
      },
    )
    .patch(
      "/ai/clients/:clientId",
      zValidator("param", updateAiClientParamSchema),
      zValidator("json", updateAiClientBodySchema),
      async (c) => {
        try {
          const { clientId } = c.req.valid("param");
          const { name, type, config, isDefault, enabled } = c.req.valid("json");

          const updated = await engine.aiClients.update({
            clientId,
            data: {
              name,
              type,
              config,
              isDefault,
              enabled,
            },
          });

          return json(c, { client: updated });
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(
            c,
            "PATCH /api/ai/clients/:clientId",
            cause,
            "Failed to update AI client",
          );
        }
      },
    )
    .delete(
      "/ai/clients/:clientId",
      zValidator("param", deleteAiClientParamSchema),
      async (c) => {
        try {
          const { clientId } = c.req.valid("param");
          return json(c, await engine.aiClients.delete({ clientId }));
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(
            c,
            "DELETE /api/ai/clients/:clientId",
            cause,
            "Failed to delete AI client",
          );
        }
      },
    )
    .put(
      "/ai/clients/:clientId/bindings",
      zValidator("param", updateAiBindingsParamSchema),
      zValidator("json", updateAiBindingsBodySchema),
      async (c) => {
        try {
          const { clientId } = c.req.valid("param");
          const { features } = c.req.valid("json");

          const bindings = await engine.aiClients.updateBindings({
            clientId,
            features,
            validFeatureSet: new Set(VALID_AI_FEATURES as readonly string[]),
          });

          return json(c, { bindings });
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(
            c,
            "PUT /api/ai/clients/:clientId/bindings",
            cause,
            "Failed to update feature bindings",
          );
        }
      },
    );
}
