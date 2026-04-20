/**
 * @agent-dashboard/runtime-client
 *
 * Shared runtime types and utilities for task execution adapters.
 * No database or application-specific dependencies.
 */

// Shared runtime types
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

// Config spec utilities
export {
  getValueAtPath,
  setValueAtPath,
  deleteValueAtPath,
  validateTaskConfigAgainstSpec,
  readMissingRequiredPaths,
  readRequiredFieldLabel,
} from "./config-spec";
