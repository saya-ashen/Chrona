import { createBridgeApp } from "./http/app";
import { createBridgeLogger } from "./logging/logger";
import { DEFAULT_BRIDGE_ENVIRONMENT } from "./shared/constants";
import type { StartBridgeServerOptions } from "./shared/types";
import { checkGatewayAvailable, executeGatewayRequest } from "./execution/gateway";

export {
  buildGatewayBody,
  checkGatewayAvailable,
  executeGatewayRequest,
  gatewayHeaders,
  resetBridgeSessions,
  statusForResponse,
} from "./execution/gateway";
export { createBridgeApp } from "./http/app";
export { createBridgeLogger } from "./logging/logger";
export {
  matchRoute,
  routeLabel,
} from "./parse/routes";
export {
  normalizeExecutionRequest,
  normalizeFeatureRequest,
  summarizeBridgeRequest,
  validationErrorMessage,
} from "./parse/requests";
export {
  buildFeatureResultFromResponse,
  buildStructuredResult,
  extractOutputText,
} from "./features/feature-contracts";
export {
  mapGatewaySseEvent,
  mapUsage,
  parseFunctionItems,
} from "./parse/gateway-response";
export type * from "./shared/types";

export function startBridgeServer(options: StartBridgeServerOptions = {}) {
  const port = options.port ?? DEFAULT_BRIDGE_ENVIRONMENT.defaultPort;
  const hostname = options.hostname ?? "0.0.0.0";
  const logger = options.logger ?? createBridgeLogger();
  const environment = DEFAULT_BRIDGE_ENVIRONMENT;

  const app = createBridgeApp({
    logger,
    environment,
    checkGatewayAvailable:
      options.checkGatewayAvailable ?? (() => checkGatewayAvailable(environment)),
    executeRequest:
      options.executeRequest ??
      ((route, request) => executeGatewayRequest(route, request, logger, environment)),
  });

  const server = Bun.serve({
    port,
    hostname,
    fetch: app.fetch,
  });

  logger.info("bridge.started", {
    port,
    hostname,
    pid: process.pid,
    gateway: environment.gatewayUrl,
    agentId: environment.agentId,
  });

  return server;
}

if (import.meta.main) {
  startBridgeServer();
}
