import { Hono } from "hono";
import type { ChronaEngine } from "@chrona/engine";
import { AI_FEATURES, releasedProviderTypes } from "@chrona/contracts";

import { json } from "../lib/http";

function isDebugProviderEnabled() {
  // Bun compile can fold NODE_ENV as development in a packaged binary. Keep
  // the debug provider behind one explicit runtime opt-in so fresh releases
  // never expose it accidentally.
  return process.env.CHRONA_ENABLE_DEBUG_PROVIDER === "true";
}

function getRuntimeLabel(key: string) {
  if (key === "hermes") return "Hermes";
  if (key === "claude_code") return "Claude Code";
  if (key === "codex") return "Codex";
  if (key === "omp") return "Oh My Pi";
  if (key === "debug") return "Debug Provider";
  return key;
}

const AI_PROVIDER_TYPES = [...releasedProviderTypes, "debug"] as const;
const BINDABLE_PRODUCT_FEATURES = AI_FEATURES.filter((feature) =>
  ["goal.review", "dashboard.brief", "task.plan", "task.execution"].includes(feature),
);
const NON_DURABLE_PRODUCT_FEATURES = BINDABLE_PRODUCT_FEATURES.filter(
  (feature) => feature !== "goal.review" && feature !== "task.plan",
);
/** Matches binding validation: planning/review need durable attach or terminal-only single-attempt recovery. */
const PROVIDER_BINDABLE_FEATURES = {
  omp: BINDABLE_PRODUCT_FEATURES,
  claude_code: NON_DURABLE_PRODUCT_FEATURES,
  codex: NON_DURABLE_PRODUCT_FEATURES,
  debug: BINDABLE_PRODUCT_FEATURES,
} as const;
const PROVIDER_SUPPORT_TIERS = {
  omp: "stable",
  claude_code: "beta",
  codex: "beta",
  debug: "experimental",
} as const;

export function createRuntimeRoutes(_engine: ChronaEngine) {
  return new Hono().get("/runtime/providers", (c) =>
    json(c, {
      providers: AI_PROVIDER_TYPES
        .filter((key) => key !== "debug" || isDebugProviderEnabled())
        .map((key) => ({
          key,
          label: getRuntimeLabel(key),
          tier: PROVIDER_SUPPORT_TIERS[key],
          features: PROVIDER_BINDABLE_FEATURES[key],
        })),
    }),
  );
}
