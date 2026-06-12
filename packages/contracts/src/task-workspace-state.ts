/**
 * Task workspace runtime state events.
 *
 * Pushed over the task workspace SSE bus alongside `spec.patch` and
 * `task_workspace_updated`. The client feeds these into a
 * `StateProvider` (see `@json-render/react`) so spec elements can read
 * dynamic data via `$state` JSON Pointer expressions.
 *
 * `StateModel` is intentionally `Record<string, unknown>` — it matches
 * the shape consumed by `createStateStore` from `@json-render/core`.
 */
export type StateModel = Record<string, unknown>;

/**
 * Full state snapshot pushed on SSE connect. Replaces the legacy
 * `ready` handshake — clients use it to seed the StateProvider store
 * before any delta arrives, so reconnecting streams self-heal without
 * needing an additional REST call.
 */
export interface TaskWorkspaceStateSnapshotEvent {
  type: "state.snapshot";
  state: StateModel;
}

/**
 * Batched state delta. `updates` is a `{ [jsonPointerPath]: value }`
 * map. Semantics mirror `StateStore.update`: only paths whose value
 * changes are applied, and a single subscriber notification is emitted.
 *
 * Use for: plan generation stream (`/plan/active` -> `/state/plan/*`),
 * execution status (`/state/execution/*`), runtime traces
 * (`/state/runtime/...`), drawer payloads (`/state/drawer/...`).
 */
export interface TaskWorkspaceStateUpdateEvent {
  type: "state.update";
  updates: Record<string, unknown>;
}
