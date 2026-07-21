import { z } from "zod";

import { workspaceId } from "./common";

export const taskDefinitionStatusSchema = z.enum(["Draft", "Active", "Paused", "Completed", "Stopped"]);
export const taskOccurrenceStatusSchema = z.enum([
  "Scheduled",
  "Ready",
  "Running",
  "WaitingForInput",
  "WaitingForApproval",
  "Blocked",
  "Failed",
  "Completed",
  "Cancelled",
  "Ignored",
]);
export const taskTriggerStateSchema = z.enum(["Enabled", "Paused", "Retired"]);
export const triggerDeliveryStatusSchema = z.enum(["Received", "Accepted", "Ignored", "Duplicate", "Failed"]);

const scheduleTriggerConfigSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("once"),
    fireAt: z.string().datetime(),
    timezone: z.string().trim().min(1),
    durationMs: z.number().int().positive().optional(),
  }),
  z.object({
    mode: z.literal("recurring"),
    rrule: z.string().trim().min(1),
    anchorStartAt: z.string().datetime(),
    timezone: z.string().trim().min(1),
    durationMs: z.number().int().positive().optional(),
    windowUntil: z.string().datetime().optional(),
  }),
]);

const eventFilterSchema = z.object({
  path: z.string().trim().min(1),
  operator: z.enum(["eq", "neq", "contains"]),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const taskTriggerDefinitionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("schedule"), config: scheduleTriggerConfigSchema }),
  z.object({
    kind: z.literal("event"),
    config: z.object({
      topic: z.enum(["task.result.accepted", "goal.review_due"]),
      filter: eventFilterSchema.optional(),
    }),
  }),
  z.object({
    kind: z.literal("email"),
    config: z.object({
      recipient: z.string().trim().min(1).max(120),
      subjectContains: z.string().trim().max(200).optional(),
    }).strict(),
  }),
]);

export const createTaskTriggerBodySchema = z.object({
  workspaceId,
  definition: taskTriggerDefinitionSchema,
});

export const updateTaskTriggerBodySchema = z.object({
  workspaceId,
  definition: taskTriggerDefinitionSchema,
  expectedVersion: z.number().int().positive(),
});

export const taskTriggerActionBodySchema = z.object({
  workspaceId,
  action: z.enum(["pause", "resume", "retire"]),
});

export const taskTriggerParamSchema = z.object({
  taskId: z.string().trim().min(1),
  triggerId: z.string().trim().min(1),
});

export const taskOccurrenceParamSchema = z.object({
  taskId: z.string().trim().min(1),
  occurrenceId: z.string().trim().min(1),
});

export const listTaskOccurrencesQuerySchema = z.object({ workspaceId });

export const emailTriggerDeliveryBodySchema = z.object({
  timestamp: z.coerce.date(),
  workspaceId,
  deliveryId: z.string().trim().min(1).max(200),
  recipient: z.string().trim().min(1).max(120),
  from: z.string().trim().min(1).max(320),
  subject: z.string().trim().max(500),
  text: z.string().max(50_000),
  receivedAt: z.coerce.date(),
}).strict();

export type TaskDefinitionStatus = z.infer<typeof taskDefinitionStatusSchema>;
export type TaskOccurrenceStatus = z.infer<typeof taskOccurrenceStatusSchema>;
export type TaskTriggerState = z.infer<typeof taskTriggerStateSchema>;
export type TriggerDeliveryStatus = z.infer<typeof triggerDeliveryStatusSchema>;
export type TaskTriggerDefinition = z.infer<typeof taskTriggerDefinitionSchema>;
export type CreateTaskTriggerRequest = z.infer<typeof createTaskTriggerBodySchema>;
export type UpdateTaskTriggerRequest = z.infer<typeof updateTaskTriggerBodySchema>;
export type TaskTriggerActionRequest = z.infer<typeof taskTriggerActionBodySchema>;
export type EmailTriggerDeliveryRequest = z.infer<typeof emailTriggerDeliveryBodySchema>;
