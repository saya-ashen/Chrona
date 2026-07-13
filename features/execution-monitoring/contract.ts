import type { PlanExecutionSSEEvent } from "@chrona/contracts";

export type WorkspaceRuntimeEvent = Extract<PlanExecutionSSEEvent, { type: "runtime_event" }>;
