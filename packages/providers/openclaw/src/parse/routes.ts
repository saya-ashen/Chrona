import { FEATURE_ENDPOINTS } from "../shared/constants";
import type { RouteKind } from "../shared/types";

export function routeLabel(route: RouteKind): string {
  return route.kind === "feature"
    ? route.stream
      ? `features.${route.feature}.stream`
      : `features.${route.feature}`
    : route.stream
      ? "execution.task.stream"
      : "execution.task";
}

export function matchRoute(pathname: string): RouteKind | null {
  const featureRoute = FEATURE_ENDPOINTS.find(
    (endpoint) => endpoint.pathname === pathname,
  );
  if (featureRoute) {
    return {
      kind: "feature",
      feature: featureRoute.feature,
      stream: featureRoute.stream,
    };
  }
  if (pathname === "/v1/execution/task") {
    return { kind: "execution", stream: false };
  }
  if (pathname === "/v1/execution/task/stream") {
    return { kind: "execution", stream: true };
  }
  return null;
}
