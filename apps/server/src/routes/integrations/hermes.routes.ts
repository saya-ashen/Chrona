import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  detectHermesEnvironment,
  generateHermesApiKey,
  getHermesEnvApiKey,
  maskHermesApiKey,
  planHermesSetup,
  restartHermesGateway,
  setupLocalHermesIntegration,
} from "@chrona/integrations/hermes";
import { z } from "zod";

import { error, internalServerError, json } from "../../lib/http";

const hermesIntegrationSchema = z.object({
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  mcpUrl: z.string().optional(),
  hermesHome: z.string().optional(),
  pluginDir: z.string().optional(),
  timeoutMs: z.number().positive().optional(),
});

const hermesSetupSchema = hermesIntegrationSchema.extend({
  apiKey: z.string().optional(),
  skipEnable: z.boolean().optional(),
});

export function createHermesIntegrationRoutes() {
  return new Hono()
    .post(
      "/integrations/hermes/diagnose",
      zValidator("json", hermesIntegrationSchema),
      async (c) => {
        try {
          const input = c.req.valid("json");
          const diagnostics = await detectHermesEnvironment(input);
          const plan = planHermesSetup(diagnostics);
          return json(c, { diagnostics, plan });
        } catch (cause) {
          return internalServerError(
            c,
            "POST /api/integrations/hermes/diagnose",
            cause,
            "Failed to diagnose Hermes integration",
          );
        }
      },
    )
    .post(
      "/integrations/hermes/restart-local",
      async (c) => {
        try {
          const result = restartHermesGateway();
          return json(c, result);
        } catch (cause) {
          return internalServerError(
            c,
            "POST /api/integrations/hermes/restart-local",
            cause,
            "Failed to restart Hermes gateway",
          );
        }
      },
    )
    .post(
      "/integrations/hermes/setup-local",
      zValidator("json", hermesSetupSchema),
      async (c) => {
        try {
          const input = c.req.valid("json");
          const apiKey = input.apiKey ?? getHermesEnvApiKey(input.hermesHome) ?? generateHermesApiKey();
          const result = await setupLocalHermesIntegration({ ...input, apiKey });
          return json(c, {
            ...result,
            apiKey: input.apiKey ? undefined : apiKey,
            maskedApiKey: maskHermesApiKey(apiKey),
          });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to configure local Hermes integration";
          if (message.includes("Local Hermes setup is only available")) {
            return error(c, message, 400);
          }
          return internalServerError(
            c,
            "POST /api/integrations/hermes/setup-local",
            cause,
            "Failed to configure local Hermes integration",
          );
        }
      },
    );
}
