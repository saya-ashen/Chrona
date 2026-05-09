import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  createAiClient,
  deleteAiClient,
  listAiClients,
  testAiClientAvailability,
  updateAiClient,
  updateAiClientBindings,
} from "@chrona/engine";
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
import { error, internalServerError, json } from "../../lib/http";

export function createClientsRoutes() {
  // ──────────────────────────────────────────────
  // AI Client Management
  // ──────────────────────────────────────────────

  return new Hono()
    .get("/ai/clients", async (c) => {
      try {
        const clients = await listAiClients();

        return json(c, {
          clients: clients.map((client) => ({
            id: client.id,
            name: client.name,
            type: client.type,
            config: client.config,
            isDefault: client.isDefault,
            enabled: client.enabled,
            bindings: client.bindings.map((binding) => binding.feature),
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

          const client = await createAiClient({
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

          const result = await testAiClientAvailability({
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
          const { name, config, isDefault, enabled } = c.req.valid("json");

          const updated = await updateAiClient(clientId, {
            name,
            config,
            isDefault,
            enabled,
          });

          return json(c, { client: updated });
        } catch (cause) {
          const message =
            cause instanceof Error
              ? cause.message
              : "Failed to update AI client";
          if (message === "Client not found") {
            return error(c, message, 404);
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
          await deleteAiClient(clientId);
          return json(c, { success: true });
        } catch {
          return error(c, "Client not found", 404);
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

          const bindings = await updateAiClientBindings({
            clientId,
            features,
            validFeatureSet: new Set(VALID_AI_FEATURES as readonly string[]),
          });

          return json(c, { bindings });
        } catch (cause) {
          const message =
            cause instanceof Error
              ? cause.message
              : "Failed to update feature bindings";
          if (message === "Client not found") {
            return error(c, message, 404);
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
