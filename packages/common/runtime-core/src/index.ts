/**
 * @chrona/runtime-core
 *
 * Canonical runtime contracts and config-spec helpers.
 * Backend-agnostic: no OpenClaw protocol, no transport, no orchestration.
 */

export type {
  RuntimeInput,
  RuntimeTaskConfigField,
  RuntimeTaskConfigFieldConstraints,
  RuntimeTaskConfigFieldKind,
  RuntimeTaskConfigFieldOption,
  RuntimeTaskConfigFieldVisibilityRule,
  RuntimeTaskConfigSpec,
  RuntimeExecutionAdapter,
  RuntimeAdapterDefinition,
} from "./types";

export {
  getValueAtPath,
  setValueAtPath,
  deleteValueAtPath,
  validateTaskConfigAgainstSpec,
  readMissingRequiredPaths,
  readRequiredFieldLabel,
} from "./config-spec";
