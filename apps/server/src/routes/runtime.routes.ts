import { Hono } from "hono";
import type { ChronaEngine } from "@chrona/engine";

import { json } from "../lib/http";

function getRuntimeLabel(key: string) {
  if (key === "hermes") return "Hermes";
  return key;
}

export function createRuntimeRoutes(engine: ChronaEngine) {
  return new Hono().get("/runtime/providers", (c) =>
    json(c, {
      providers: engine.runtime.listExecutionRuntimes().map((key) => ({
        key,
        label: getRuntimeLabel(key),
      })),
    }),
  );
}
