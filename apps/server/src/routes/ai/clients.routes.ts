import { Hono, type Context } from "hono";
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

type AiClientRouteRecord = {
  id: string;
  name: string;
  type: string;
  config: unknown;
  isDefault: boolean;
  enabled: boolean;
  createdAt: Date;
  bindings?: Array<{ feature: string }>;
};

const PUBLIC_CONFIG_KEYS: Record<string, Record<string, true>> = {
  llm: { baseUrl: true, model: true, temperature: true, timeoutSeconds: true, timeoutMs: true },
  hermes: { baseUrl: true, timeoutMs: true },
  debug: { profile: true },
  claude_code: { model: true, timeoutMs: true, mcpBaseUrl: true, configDirectory: true, profileName: true, cwd: true },
  codex: { model: true, timeoutMs: true, baseUrl: true, configDirectory: true, profileName: true, cwd: true },
  omp: { model: true, provider: true, baseUrl: true, api: true, timeoutMs: true, homeDirectory: true, configDirectory: true, codingAgentDirectory: true, cwd: true },
};

function redactClientConfig(type: string, config: unknown): Record<string, unknown> {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const allowedKeys = PUBLIC_CONFIG_KEYS[type] ?? {};
  const publicConfig: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === "env" && value && typeof value === "object" && !Array.isArray(value)) {
      publicConfig.env = Object.fromEntries(Object.keys(value).map((name) => [name, true]));
    } else if (Object.hasOwn(allowedKeys, key)) {
      publicConfig[key] = value;
    }
  }
  return publicConfig;
}

function serializeClient(client: AiClientRouteRecord) {
  return {
    id: client.id,
    name: client.name,
    type: client.type,
    config: redactClientConfig(client.type, client.config),
    isDefault: client.isDefault,
    enabled: client.enabled,
    bindings: (client.bindings ?? []).map(
      (binding: { feature: string }) => binding.feature,
    ),
    createdAt: client.createdAt.toISOString(),
  };
}

function registerClientReadRoutes(app: Hono, engine: ChronaEngine) {
  app
    .get("/ai/clients", async (c) => {
      try {
        const clients = await engine.aiClients.list();
        return json(c, { clients: clients.map(serializeClient) });
      } catch (cause) {
        return internalServerError(c, "GET /api/ai/clients", cause, "Failed to list AI clients");
      }
    })
    .get("/ai/clients/:clientId/diagnostics", async (c) => {
      try {
        const clientId = c.req.param("clientId");
        const client = await engine.runtime.aiClients.get(clientId);
        if (!client) return error(c, "AI client not found", 404);
        const providerClient = client.providerClient;
        if (!providerClient) {
          return json(c, { capabilities: null, configurationCapabilities: null, diagnostics: null });
        }
        const [capabilities, diagnostics] = await Promise.all([
          providerClient.getCapabilities(),
          providerClient.getRuntimeDiagnostics?.() ?? null,
        ]);
        return json(c, {
          capabilities,
          configurationCapabilities: providerClient.getConfigurationCapabilities?.() ?? null,
          diagnostics,
        });
      } catch (cause) {
        return internalServerError(
          c,
          "GET /api/ai/clients/:clientId/diagnostics",
          cause,
          "Failed to inspect AI client",
        );
      }
    });
}

function registerClientCreateRoutes(app: Hono, engine: ChronaEngine) {
  app
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
          return json(c, { client: serializeClient({ ...client, bindings: [] }) }, 201);
        } catch (cause) {
          return internalServerError(c, "POST /api/ai/clients", cause, "Failed to create AI client");
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
          return internalServerError(c, "POST /api/ai/clients/test", cause, "Failed to test AI client");
        }
      },
    );
}

function mutationFailure(c: Context, cause: unknown, route: string, message: string) {
  const httpError = toHttpError(cause);
  if (httpError) return error(c, httpError.message, httpError.status);
  return internalServerError(c, route, cause, message);
}

function registerClientMutationRoutes(app: Hono, engine: ChronaEngine) {
  app
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
            data: { name, type, config, isDefault, enabled },
          });
          return json(c, { client: serializeClient(updated) });
        } catch (cause) {
          return mutationFailure(c, cause, "PATCH /api/ai/clients/:clientId", "Failed to update AI client");
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
          return mutationFailure(c, cause, "DELETE /api/ai/clients/:clientId", "Failed to delete AI client");
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
          return mutationFailure(
            c,
            cause,
            "PUT /api/ai/clients/:clientId/bindings",
            "Failed to update feature bindings",
          );
        }
      },
    );
}

export function createClientsRoutes(engine: ChronaEngine) {
  const app = new Hono();
  registerClientReadRoutes(app, engine);
  registerClientCreateRoutes(app, engine);
  registerClientMutationRoutes(app, engine);
  return app;
}
