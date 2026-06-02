import { z } from "zod";

export const calendarSourceTypeSchema = z.literal("subscription");
export const calendarSourceLifecycleStateSchema = z.enum([
  "active",
  "disabled",
  "removing",
  "removed",
]);
export const calendarEventStatusSchema = z.enum(["confirmed", "tentative", "cancelled"]);
export const calendarSourceSyncPolicySchema = z.enum(["keep_active", "auto_complete_past_events"]);
export const calendarAutomationPolicySchema = z.enum(["manual", "auto_plan", "auto_execute"]);
export const calendarValidationErrorCodeSchema = z.enum([
  "invalid_url",
  "unsupported_scheme",
  "blocked_network",
  "unreachable",
  "unauthorized",
  "malformed_calendar",
  "too_large",
  "unknown",
]);

export const calendarSourceSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sourceType: calendarSourceTypeSchema,
  redactedUrlLabel: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  syncPolicy: calendarSourceSyncPolicySchema,
  automationPolicy: calendarAutomationPolicySchema,
  lifecycleState: calendarSourceLifecycleStateSchema,
  lastSuccessfulRefreshAt: z.string().datetime().optional(),
  nextExpectedRefreshAt: z.string().datetime().optional(),
  lastErrorCode: calendarValidationErrorCodeSchema.optional(),
  lastErrorMessage: z.string().optional(),
});

export const calendarSyncStatusSchema = z.object({
  sourceId: z.string().min(1),
  state: z.enum(["idle", "syncing", "success", "partial", "failed"]),
  lastSuccessfulRefreshAt: z.string().datetime().optional(),
  nextExpectedRefreshAt: z.string().datetime().optional(),
  latestErrorCode: calendarValidationErrorCodeSchema.optional(),
  latestErrorMessage: z.string().optional(),
  importedCount: z.number().int().min(0),
  skippedCount: z.number().int().min(0),
});

export const importedCalendarEventSummarySchema = z.object({
  id: z.string().min(1),
  calendarSourceId: z.string().min(1),
  sourceName: z.string().min(1),
  sourceColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  title: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  isAllDay: z.boolean(),
  status: calendarEventStatusSchema,
  readOnly: z.literal(true),
});

export const validateCalendarSourceRequestSchema = z.object({
  url: z.string().min(1),
  allowBlockedNetwork: z.boolean().optional(),
});

export const validateCalendarSourceSuccessSchema = z.object({
  valid: z.literal(true),
  detectedName: z.string().optional(),
  eventPreviewCount: z.number().int().min(0),
  redactedUrlLabel: z.string().min(1),
  warnings: z.array(z.string()),
});

export const validateCalendarSourceFailureSchema = z.object({
  valid: z.literal(false),
  errorCode: calendarValidationErrorCodeSchema,
  message: z.string().min(1),
});

export const validateCalendarSourceResponseSchema = z.discriminatedUnion("valid", [
  validateCalendarSourceSuccessSchema,
  validateCalendarSourceFailureSchema,
]);

export const createCalendarSourceRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  syncPolicy: calendarSourceSyncPolicySchema.optional(),
  automationPolicy: calendarAutomationPolicySchema.optional(),
  allowBlockedNetwork: z.boolean().optional(),
});

export const refreshCalendarSourceRequestSchema = z.object({
  allowBlockedNetwork: z.boolean().optional(),
}).optional();

export const updateCalendarSourceRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  syncPolicy: calendarSourceSyncPolicySchema.optional(),
  automationPolicy: calendarAutomationPolicySchema.optional(),
  enabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one update field is required");

export const calendarSourceResponseSchema = z.object({
  source: calendarSourceSummarySchema,
  syncStatus: calendarSyncStatusSchema.optional(),
});

export const calendarSourceListResponseSchema = z.object({
  sources: z.array(calendarSourceSummarySchema),
});

export const importedCalendarEventListResponseSchema = z.object({
  events: z.array(importedCalendarEventSummarySchema),
});

export const calendarSourceDeleteResponseSchema = z.object({
  removed: z.literal(true),
  sourceId: z.string().min(1),
});

export type CalendarSourceType = z.infer<typeof calendarSourceTypeSchema>;
export type CalendarSourceLifecycleState = z.infer<typeof calendarSourceLifecycleStateSchema>;
export type CalendarEventStatus = z.infer<typeof calendarEventStatusSchema>;
export type CalendarSourceSyncPolicy = z.infer<typeof calendarSourceSyncPolicySchema>;
export type CalendarAutomationPolicy = z.infer<typeof calendarAutomationPolicySchema>;
export type CalendarValidationErrorCode = z.infer<typeof calendarValidationErrorCodeSchema>;
export type CalendarSourceSummary = z.infer<typeof calendarSourceSummarySchema>;
export type CalendarSyncStatus = z.infer<typeof calendarSyncStatusSchema>;
export type ImportedCalendarEventSummary = z.infer<typeof importedCalendarEventSummarySchema>;
export type ValidateCalendarSourceResponse = z.infer<typeof validateCalendarSourceResponseSchema>;
export type CreateCalendarSourceRequest = z.infer<typeof createCalendarSourceRequestSchema>;
export type RefreshCalendarSourceRequest = z.infer<typeof refreshCalendarSourceRequestSchema>;
export type UpdateCalendarSourceRequest = z.infer<typeof updateCalendarSourceRequestSchema>;
export type CalendarSourceResponse = z.infer<typeof calendarSourceResponseSchema>;
export type CalendarSourceListResponse = z.infer<typeof calendarSourceListResponseSchema>;
export type ImportedCalendarEventListResponse = z.infer<typeof importedCalendarEventListResponseSchema>;
