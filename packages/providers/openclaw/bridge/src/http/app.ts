import { Hono } from "hono";

import { createBridgeLogger } from "../logging/logger";
import { validationErrorMessage, normalizeExecutionRequest, normalizeFeatureRequest } from "../parse/requests";
import { matchRoute } from "../parse/routes";
import { encodeSSE, json, toErrorMessage } from "../shared/json";
import type { BridgeEnvironment, BridgeLogger, BridgeRequest, ExecutionResult, RouteKind } from "../shared/types";
import { DEFAULT_BRIDGE_ENVIRONMENT } from "../shared/constants";
import {
  checkGatewayAvailable,
  executeGatewayRequest,
  executionErrorData,
  statusForResponse,
} from "../execution/gateway";

export interface CreateBridgeAppOptions {
  logger?: BridgeLogger;
  environment?: BridgeEnvironment;
  checkGatewayAvailable?: () => Promise<boolean>;
  executeRequest?: (
    route: RouteKind,
    request: BridgeRequest,
  ) => Promise<ExecutionResult>;
}

export function createBridgeApp(options: CreateBridgeAppOptions = {}): Hono {
  const logger = options.logger ?? createBridgeLogger();
  const environment = options.environment ?? DEFAULT_BRIDGE_ENVIRONMENT;
  const gatewayAvailability =
    options.checkGatewayAvailable ?? (() => checkGatewayAvailable(environment));
  const executeRequest =
    options.executeRequest ??
    ((route: RouteKind, request: BridgeRequest) =>
      executeGatewayRequest(route, request, logger, environment));

  const app = new Hono();

  app.use("*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "Content-Type");
    c.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    await next();
  });

  app.options("*", (c) => c.body(null, 204));

  app.get("/v1/health", async (c) => {
    const available = await gatewayAvailability();
    return c.json({
      status: available ? "ok" : "unavailable",
      gateway: environment.gatewayHttpUrl,
    });
  });

  app.all("*", async (c) => {
    const route = matchRoute(new URL(c.req.url).pathname);
    if (!route || c.req.method !== "POST") {
      return c.json({ error: "Not found" }, 404);
    }

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const normalized =
      route.kind === "feature"
        ? normalizeFeatureRequest(payload)
        : normalizeExecutionRequest(payload);

    if (!normalized) {
      return c.json({ error: validationErrorMessage(route) }, 400);
    }

    try {
      const { response, events } = await executeRequest(route, normalized);
      if (!route.stream) {
        return c.json(response, { status: statusForResponse(route, response) as 200 | 422 | 500 });
      }

      const stream = new ReadableStream({
        start(controller) {
          for (const event of events) {
            controller.enqueue(encodeSSE("event", event));
          }
          controller.enqueue(encodeSSE("done", response));
          controller.close();
        },
      });

      return c.newResponse(stream, {
        status: (response.error ? statusForResponse(route, response) : 200) as 200 | 422 | 500,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        },
      });
    } catch (error) {
      logger.error("bridge.request.error", executionErrorData(route, normalized, error));

      if (route.stream) {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encodeSSE("error", { error: toErrorMessage(error) }));
            controller.close();
          },
        });
        return c.newResponse(stream, 500, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        });
      }

      return json({ error: toErrorMessage(error) }, { status: 500 });
    }
  });

  return app;
}
