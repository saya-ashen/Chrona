import { Hono } from "hono";
import type { ChronaEngine } from "@chrona/engine";

import { json } from "../lib/http";

function isDebugProviderEnabled() {
  return (
    process.env.NODE_ENV === "development"
    || process.env.CHRONA_ENABLE_DEBUG_PROVIDER === "true"
  );
}

function getRuntimeLabel(key: string) {
  if (key === "hermes") return "Hermes";
  if (key === "claude_code") return "Claude Code";
  if (key === "debug") return "Debug Provider";
  return key;
}

export function createRuntimeRoutes(engine: ChronaEngine) {
  return new Hono().get("/runtime/providers", (c) =>
    json(c, {
      providers: engine.runtime.listExecutionRuntimes()
        .filter((key) => key !== "debug" || isDebugProviderEnabled())
        .map((key) => ({
          key,
          label: getRuntimeLabel(key),
        })),
    }),
  );
}
