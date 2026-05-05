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
