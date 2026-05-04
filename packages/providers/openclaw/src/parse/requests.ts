import type { BridgeFeatureRequest, BridgeRequest, RouteKind } from "../shared/types";
import { routeLabel } from "./routes";

function isFeatureRequest(
  request: BridgeRequest,
): request is BridgeFeatureRequest<Record<string, unknown>> {
  return "input" in request;
}

function summarizeInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { kind: typeof value };
  }
  return { keys: Object.keys(value).sort() };
}

export function summarizeBridgeRequest(
  route: RouteKind,
  request: BridgeRequest,
): Record<string, unknown> {
  if (isFeatureRequest(request)) {
    return {
      route: routeLabel(route),
      sessionId: request.sessionId ?? null,
      timeout: request.timeout ?? null,
      instructionsChars: request.instructions?.length ?? 0,
      input: summarizeInput(request.input),
    };
  }

  return {
    route: routeLabel(route),
    sessionId: request.sessionId ?? null,
    timeout: request.timeout ?? null,
    instructionsChars: request.instructions.length,
    taskId: request.taskId ?? null,
    workspaceId: request.workspaceId ?? null,
    taskTitle: request.taskTitle ?? null,
    runtimeAdapterKey: request.runtimeAdapterKey ?? null,
    runtimeInputKeys: request.runtimeInput
      ? Object.keys(request.runtimeInput).sort()
      : [],
  };
}
