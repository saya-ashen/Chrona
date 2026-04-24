/**
 * @chrona/ai-features
 *
 * Canonical feature-layer entry for synchronous/streaming AI generation.
 * suggestion / plan / conflicts / timeslots / chat live here.
 */

export * from "./core/types";
export * from "./core/dispatch-types";
export * from "./core/prompts";
export { extractJSON, checkClientHealth, llmCall } from "./core/providers";
export * from "./features";
export * from "./core/streaming";
