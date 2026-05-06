import { z } from "zod";

/** ISO-8601 date-time string — validated, then converted to Date in handlers */
export const isoDateString = z.string().datetime({ message: "must be a valid ISO-8601 date string" });

/** Coerces an ISO string to a Date, or null if empty/missing. Use in handlers: `dueAt ? new Date(dueAt) : null` */
export const isoDateOrNull = isoDateString.nullable().optional();
export const isoDateOptional = isoDateString.optional();

export const taskStatusEnum = z.enum([
  "Todo",
  "InProgress",
  "WaitingForInput",
  "Blocked",
  "InReview",
  "Done",
  "Archived",
  "Cancelled",
  "Planned",
  "Scheduled",
  "Overdue",
  "Failed",
]);

export const taskPriorityEnum = z.enum(["Low", "Medium", "High", "Urgent"]);

export const workspaceId = z.string().min(1, "workspaceId is required");
export const taskIdParam = z.string().min(1, "taskId is required");

/** Response wrapper used by `c.json()` in most routes — loose shape for engine results */
export const successResponse = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ success: z.literal(true).optional(), ...(data.shape ?? {}) }).passthrough();

export const errorResponse = z.object({ error: z.string() });
