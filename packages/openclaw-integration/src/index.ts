/**
 * @chrona/openclaw-integration
 *
 * Canonical OpenClaw-specific integration layer.
 * Contains transport, protocol, runtime adapter/orchestration, and bridge-facing helpers.
 */

export type {
  RuntimeInput,
  RuntimeExecutionAdapter,
  RuntimeAdapterDefinition,
  RuntimeTaskConfigSpec,
} from "../../runtime-core/src/index";

export * from "./transport/bridge-client";
export * from "./transport/bridge-types";
export * from "./runtime/runtime-client";
export * from "./runtime/adapter";
export * from "./runtime/orchestrator";
export * from "./runtime/mock-adapter";
export * from "./config/config";
export * from "./config/probe";
export * from "./config/evaluate-gate";
export * from "./config/device-identity";
export * from "./protocol/types";
export * from "./protocol/structured-result";

