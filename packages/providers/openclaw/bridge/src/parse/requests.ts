import type {
  BridgeExecutionTaskRequest,
  BridgeFeatureRequest,
  BridgeRequest,
  RouteKind,
} from "../shared/types";
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

export function normalizeFeatureRequest(
  payload: unknown,
): BridgeFeatureRequest<Record<string, unknown>> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const request = payload as Record<string, unknown>;
  const input = request.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  return {
    sessionId:
      typeof request.sessionId === "string" && request.sessionId.trim()
        ? request.sessionId
        : undefined,
    sessionKey:
      typeof request.sessionKey === "string" && request.sessionKey.trim()
        ? request.sessionKey
        : undefined,
    input: input as Record<string, unknown>,
    instructions:
      typeof request.instructions === "string" && request.instructions.trim()
        ? request.instructions
        : undefined,
    timeout: typeof request.timeout === "number" ? request.timeout : undefined,
  };
}

export function normalizeExecutionRequest(
  payload: unknown,
): BridgeExecutionTaskRequest | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const request = payload as Record<string, unknown>;
  if (
    typeof request.instructions !== "string" ||
    !request.instructions.trim()
  ) {
    return null;
  }

  return {
    sessionId:
      typeof request.sessionId === "string" && request.sessionId.trim()
        ? request.sessionId
        : undefined,
    sessionKey:
      typeof request.sessionKey === "string" && request.sessionKey.trim()
        ? request.sessionKey
        : undefined,
    instructions: request.instructions,
    taskId: typeof request.taskId === "string" ? request.taskId : undefined,
    workspaceId:
      typeof request.workspaceId === "string" ? request.workspaceId : undefined,
    taskTitle:
      typeof request.taskTitle === "string" ? request.taskTitle : undefined,
    runtimeAdapterKey:
      typeof request.runtimeAdapterKey === "string"
        ? request.runtimeAdapterKey
        : undefined,
    runtimeInput:
      request.runtimeInput &&
      typeof request.runtimeInput === "object" &&
      !Array.isArray(request.runtimeInput)
        ? (request.runtimeInput as Record<string, unknown>)
        : undefined,
    timeout: typeof request.timeout === "number" ? request.timeout : undefined,
  };
}

export function validationErrorMessage(route: RouteKind): string {
  return route.kind === "feature"
    ? "Missing required field: input"
    : "Missing required field: instructions";
}

export function routeMethodList(): string {
  return "GET,POST,OPTIONS";
}

export { isFeatureRequest, routeLabel };
