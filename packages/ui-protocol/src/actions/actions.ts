import { z } from "zod";

/**
 * Action names a document may emit. The renderer's action dispatcher maps these
 * to the host's existing callbacks (`onDispatchExecutionAction`,
 * `onSubmitCheckpointAction`). Documents never call code directly — they only
 * reference these names with a payload validated against the schemas below.
 */
export const UI_ACTION = {
  commandCenterPrimary: "command-center-primary",
  acceptPlan: "accept-plan",
  generatePlan: "generate-plan",
  revisePlan: "revise-plan",
  stopPlanGeneration: "stop-plan-generation",
  dispatchExecution: "dispatch-execution",
  locateWorkspaceNode: "locate-workspace-node",
  submitCheckpoint: "submit-checkpoint",
  recoveryRetry: "recovery-retry",
  recoveryEditInstruction: "recovery-edit-instruction",
  recoveryCancel: "recovery-cancel",
} as const;

export type UiActionName = (typeof UI_ACTION)[keyof typeof UI_ACTION];
export const commandCenterPrimaryPayloadSchema = z.object({
  actionId: z.string().min(1),
});
export const acceptPlanPayloadSchema = z.object({}).optional();

export const generatePlanPayloadSchema = z.object({}).optional();

export const revisePlanPayloadSchema = z.object({
  instruction: z.string().optional(),
});

export const stopPlanGenerationPayloadSchema = z.object({}).optional();

export const dispatchExecutionPayloadSchema = z.object({
  actionId: z.string().min(1),
});

export const locateWorkspaceNodePayloadSchema = z.object({
  nodeId: z.string().min(1),
});

export const submitCheckpointPayloadSchema = z.object({
  checkpointId: z.string().optional(),
  actionId: z.string().optional(),
  values: z.record(z.string(), z.string()).optional(),
});

export const recoveryRetryPayloadSchema = z.object({}).optional();
export const recoveryEditInstructionPayloadSchema = z.object({}).optional();
export const recoveryCancelPayloadSchema = z.object({}).optional();

export const UI_ACTION_PAYLOAD = {
  [UI_ACTION.commandCenterPrimary]: commandCenterPrimaryPayloadSchema,
  [UI_ACTION.acceptPlan]: acceptPlanPayloadSchema,
  [UI_ACTION.revisePlan]: revisePlanPayloadSchema,
  [UI_ACTION.generatePlan]: generatePlanPayloadSchema,
  [UI_ACTION.stopPlanGeneration]: stopPlanGenerationPayloadSchema,
  [UI_ACTION.dispatchExecution]: dispatchExecutionPayloadSchema,
  [UI_ACTION.locateWorkspaceNode]: locateWorkspaceNodePayloadSchema,
  [UI_ACTION.submitCheckpoint]: submitCheckpointPayloadSchema,
  [UI_ACTION.recoveryRetry]: recoveryRetryPayloadSchema,
  [UI_ACTION.recoveryEditInstruction]: recoveryEditInstructionPayloadSchema,
  [UI_ACTION.recoveryCancel]: recoveryCancelPayloadSchema,
} as const;

export type CommandCenterPrimaryPayload = z.infer<typeof commandCenterPrimaryPayloadSchema>;
export type AcceptPlanPayload = z.infer<typeof acceptPlanPayloadSchema>;
export type RevisePlanPayload = z.infer<typeof revisePlanPayloadSchema>;
export type GeneratePlanPayload = z.infer<typeof generatePlanPayloadSchema>;
export type StopPlanGenerationPayload = z.infer<typeof stopPlanGenerationPayloadSchema>;
export type DispatchExecutionPayload = z.infer<typeof dispatchExecutionPayloadSchema>;
export type LocateWorkspaceNodePayload = z.infer<typeof locateWorkspaceNodePayloadSchema>;
export type SubmitCheckpointPayload = z.infer<typeof submitCheckpointPayloadSchema>;
export type RecoveryRetryPayload = z.infer<typeof recoveryRetryPayloadSchema>;
export type RecoveryEditInstructionPayload = z.infer<typeof recoveryEditInstructionPayloadSchema>;
export type RecoveryCancelPayload = z.infer<typeof recoveryCancelPayloadSchema>;

