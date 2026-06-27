import type { PlanExecutionSSEEvent } from "@chrona/contracts/ai";

export type TaskWorkspaceSseEvent = {
  type: string;
  sequence?: number;
  commandId?: string;
  commandType?: string;
  message?: string;
  eventKind?: string;
  [key: string]: unknown;
};

export type WorkspaceRuntimeEvent = Extract<PlanExecutionSSEEvent, { type: "runtime_event" }>;
