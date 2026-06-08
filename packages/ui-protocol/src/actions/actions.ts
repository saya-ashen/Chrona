import { z } from "zod";

/**
 * Action names a document may emit. The renderer's action dispatcher maps these
 * to the host's existing callbacks (`onDispatchExecutionAction`,
 * `onSubmitCheckpointAction`). Documents never call code directly — they only
 * reference these names with a payload validated against the schemas below.
 */
export const UI_ACTION = {
  dispatchExecution: "dispatch-execution",
  locateWorkspaceNode: "locate-workspace-node",
  submitCheckpoint: "submit-checkpoint",
} as const;

export type UiActionName = (typeof UI_ACTION)[keyof typeof UI_ACTION];

export const dispatchExecutionPayloadSchema = z.object({
  actionId: z.string().min(1),
});

export const locateWorkspaceNodePayloadSchema = z.object({
  nodeId: z.string().min(1),
});

export const submitCheckpointPayloadSchema = z.object({
  actionId: z.string().optional(),
  values: z.record(z.string(), z.string()).optional(),
});

export const UI_ACTION_PAYLOAD = {
  [UI_ACTION.dispatchExecution]: dispatchExecutionPayloadSchema,
  [UI_ACTION.locateWorkspaceNode]: locateWorkspaceNodePayloadSchema,
  [UI_ACTION.submitCheckpoint]: submitCheckpointPayloadSchema,
} as const;

export type DispatchExecutionPayload = z.infer<typeof dispatchExecutionPayloadSchema>;
export type LocateWorkspaceNodePayload = z.infer<typeof locateWorkspaceNodePayloadSchema>;
export type SubmitCheckpointPayload = z.infer<typeof submitCheckpointPayloadSchema>;
