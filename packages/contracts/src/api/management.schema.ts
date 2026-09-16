/* eslint-disable complexity -- Keep the cross-field mode/timing validation matrix together. */
import { z } from "zod";
import { TASK_PRIORITIES, TASK_STATUSES } from "../task";
import { automationTimingSchema } from "../automation-timing";
import { TASK_LIST_FILTERS, TASK_LIST_SORT_FIELDS, TASK_TITLE_MAX, TASK_DESCRIPTION_MAX } from "./tasks.schema";
import { checkpointActionBodySchema, executionActionBodySchema, providerApprovalResolveBodySchema } from "./execution.schema";
import { planPatchBodySchema } from "./plans.schema";

import { managementGoalSearchSchema, managementGoalReadSchema, managementGoalProposeSchema } from "./management-goals.schema";

// Preserve the historical full preset. New authority requires explicit enrollment.
export const MANAGEMENT_LEGACY_SCOPES = ["tasks:read", "tasks:write", "schedule:write", "plans:write", "executions:control", "results:accept", "tasks:delete"] as const;
export const MANAGEMENT_SCOPES = [...MANAGEMENT_LEGACY_SCOPES, "goals:read", "goals:propose"] as const;
export const MANAGEMENT_ACCESS_PRESETS = {
  read: ["tasks:read"],
  full: MANAGEMENT_LEGACY_SCOPES,
  "assistant-read": ["goals:read"],
  assistant: ["goals:read", "goals:propose"],
} as const;
export type ManagementAccessPreset = keyof typeof MANAGEMENT_ACCESS_PRESETS;
export const managementScopeSchema = z.enum(MANAGEMENT_SCOPES);
export type ManagementScope = z.infer<typeof managementScopeSchema>;
export const managementModeSchema = z.enum(["todo", "plan", "automatic"]).describe("todo creates a task without automatic planning/execution; it is not an independent manual-todo lifecycle or a notification. plan enables planning only. automatic enables planning and execution; on create it requires start, on update start may be inferred from existing configuration.");
const id = z.string().trim().min(1).max(128);
const title = z.string().trim().min(1).max(TASK_TITLE_MAX);
const description = z.string().max(TASK_DESCRIPTION_MAX).transform((text) => text.replace(/\r\n?/g, "\n").trim());
const date = z.string().datetime({ offset: true });
export const managementTimezoneSchema = z.string().min(1).max(80).refine((zone) => {
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); return true; } catch { return false; }
}, "Unknown IANA timezone");
const schedule = z.object({ startsAt: date, endsAt: date, timezone: managementTimezoneSchema }).strict()
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), "endsAt must be after startsAt");
const recurrence = z.object({ rule: z.string().trim().min(1).max(1_000), timezone: managementTimezoneSchema }).strict();
export const managementExecutionConfigSchema = z.object({
  prompt: z.string().max(10_000).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  temperature: z.number().min(0).max(2).optional(),
  approvalPolicy: z.enum(["never", "on-request", "always"]).optional(),
  toolMode: z.enum(["read-only", "workspace-write", "full-access"]).optional(),
  sessionStrategy: z.enum(["shared", "per_subtask"]).optional(),
  contextStrategy: z.enum(["provider_default", "auto_compact", "bounded_tool_results", "artifact_backed"]).optional(),
  allowSubAgents: z.boolean().optional(),
}).strict();
const timing = z.object({ plan: automationTimingSchema.optional(), execution: automationTimingSchema.optional() }).strict();
const paging = { page: z.number().int().min(1).max(1_000).default(1), pageSize: z.number().int().min(1).max(20).default(10) };

export const managementSearchSchema = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  filter: z.enum(TASK_LIST_FILTERS).optional(), status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(), sort: z.enum(TASK_LIST_SORT_FIELDS).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"), ...paging,
}).strict().refine((input) => !(input.filter && input.status), "filter and status are mutually exclusive");
export const managementReadSchema = z.object({
  taskId: id, view: z.enum(["compact", "summary", "description", "config", "plan", "activity", "result"]).default("summary").describe("compact returns task identity, revision, deadline, projected schedule and automation only (plus the requested work block, if any). Use summary/config before execution or checkpoint actions; compact does not read runtime state."),
  workBlockId: id.optional(), planSource: z.enum(["saved", "execution"]).optional(),
  resultSource: z.enum(["current", "accepted"]).optional(),
  page: z.number().int().min(1).max(1_000).optional(), pageSize: z.number().int().min(1).max(20).optional(),
}).strict().superRefine((input, ctx) => {
  if (input.planSource && input.view !== "plan") ctx.addIssue({ code: "custom", path: ["planSource"], message: "Only valid for plan view" });
  if (input.resultSource && input.view !== "result") ctx.addIssue({ code: "custom", path: ["resultSource"], message: "Only valid for result view" });
  if ((input.page !== undefined || input.pageSize !== undefined) && !["plan", "activity", "result"].includes(input.view)) ctx.addIssue({ code: "custom", path: ["page"], message: "This view is not paginated" });
});
const creationFields = {
  title, description: description.optional(), priority: z.enum(TASK_PRIORITIES).default("Medium"),
  /** Manual lifecycle is explicit; omitted remains the existing AI task lifecycle. */
  taskExecutionMode: z.enum(["ai", "manual"]).optional(),
  mode: managementModeSchema, start: z.enum(["now", "scheduled"]).optional().describe("Only for automatic mode; omit for todo/plan. scheduled requires schedule. now forbids schedule, recurrence and timing. On update, omitted mode uses the task's existing automation settings."),
  timing: timing.optional().describe("AI automation timing, not reminder offsets. Forbidden for todo; execution timing requires automatic. Relative timing requires schedule."),
  dueAt: date.nullable().optional().describe("Independent deadline. Drives fixed in-app due indicators, not a push/email notification. Clearing schedule does not clear this deadline."),
  schedule: schedule.optional().describe("Calendar placement only; does not send notifications. Allowed for todo/plan without start. Use offset-bearing timestamps and an IANA timezone; endsAt must follow startsAt."), recurrence: recurrence.optional(),
  aiClientId: id.nullable().optional(), executionConfig: managementExecutionConfigSchema.optional(),
  goalId: id.optional(), parentTaskId: id.optional(),
};
const managementCreateExamples = [
  { requestId: "94fe9488-7c57-4342-997e-3e1efc06d3bf", title: "Check application portal", mode: "todo", schedule: { startsAt: "2030-10-01T09:00:00+08:00", endsAt: "2030-10-01T09:15:00+08:00", timezone: "Asia/Shanghai" }, dryRun: true },
  { requestId: "73e3ab4b-f1ad-49ef-b9e2-f9dcbf09a165", title: "Draft application preparation plan", mode: "plan", dryRun: true },
  { requestId: "79b978b7-80b6-4217-a195-c122e925a15b", title: "Prepare application checklist", mode: "automatic", start: "scheduled", schedule: { startsAt: "2030-10-01T09:00:00+08:00", endsAt: "2030-10-01T09:30:00+08:00", timezone: "Asia/Shanghai" }, dryRun: true },
];
export const managementCreateSchema = z.object({
  requestId: z.string().uuid(), ...creationFields, dryRun: z.boolean().default(false),
}).strict().superRefine((input, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (input.taskExecutionMode === "manual") {
    if (input.mode !== "todo") issue("mode", "Manual tasks require todo mode");
    if (input.start || input.timing || input.recurrence || input.aiClientId !== undefined || input.executionConfig) issue("taskExecutionMode", "Manual tasks cannot configure AI automation, providers, execution settings, or recurrence");
  }
  if (input.mode === "automatic" && !input.start) issue("start", "automatic requires now or scheduled");
  if (input.mode !== "automatic" && input.start) issue("start", "start is only valid for automatic");
  if (input.start === "scheduled" && !input.schedule) issue("schedule", "Scheduled execution requires a time window");
  if (input.start === "now" && (input.schedule || input.recurrence || input.timing)) issue("start", "Immediate execution cannot also schedule a window or timing");
  if (input.mode === "todo" && input.timing) issue("timing", "todo does not enable automation");
  if (input.mode !== "automatic" && input.timing?.execution) issue("timing", "Execution timing requires automatic mode");
  if (!input.schedule && Object.values(input.timing ?? {}).some((value) => value !== "immediate")) issue("timing", "Relative timing requires a schedule");
  if (input.recurrence && !input.schedule) issue("recurrence", "Recurrence requires the first schedule window");
  if (input.recurrence && input.schedule && input.recurrence.timezone !== input.schedule.timezone) issue("recurrence", "Recurrence and schedule timezone must match");
}).meta({
  // superRefine is runtime-only. Mirror structural constraints in tools/list
  // while retaining an object root (the MCP SDK hides root union schemas).
  // Protocol tests check this projection against the runtime validation matrix.
  allOf: [
    { if: { properties: { mode: { const: "automatic" } }, required: ["mode"] }, then: { required: ["start"] }, else: { not: { required: ["start"] } } },
    { if: { properties: { start: { const: "scheduled" } }, required: ["start"] }, then: { required: ["schedule"] } },
    { if: { properties: { start: { const: "now" } }, required: ["start"] }, then: { not: { anyOf: [{ required: ["schedule"] }, { required: ["recurrence"] }, { required: ["timing"] }] } } },
    { if: { properties: { mode: { const: "todo" } }, required: ["mode"] }, then: { not: { required: ["timing"] } } },
    { if: { properties: { mode: { enum: ["todo", "plan"] } }, required: ["mode"] }, then: { properties: { timing: { not: { required: ["execution"] } } } } },
    { if: { not: { required: ["schedule"] } }, then: { not: { required: ["recurrence"] }, properties: { timing: { properties: { plan: { const: "immediate" }, execution: { const: "immediate" } } } } } },
  ],
  // Zod removes standard examples from transforming input schemas. Also put
  // these input examples in the description so SDK tools/list preserves them.
  examples: managementCreateExamples,
  description: `Input examples (dry runs; use a new requestId for each write intent): ${JSON.stringify(managementCreateExamples)}`,
});
const descriptionPatch = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("replace"), text: description.pipe(z.string().min(1)) }).strict(),
  z.object({ mode: z.literal("append"), text: description.pipe(z.string().min(1)) }).strict(),
  z.object({ mode: z.literal("clear") }).strict(),
]);
export const managementUpdateSchema = z.object({
  requestId: z.string().uuid(), taskId: id, expectedRevision: z.string().min(1).max(512), dryRun: z.boolean().default(false),
  patch: z.object({
    title: title.optional(), description: descriptionPatch.optional(), priority: z.enum(TASK_PRIORITIES).optional(),
    mode: managementModeSchema.optional(), start: creationFields.start, timing: creationFields.timing,
    dueAt: creationFields.dueAt, schedule: schedule.nullable().optional().describe("Replace calendar placement, or null to clear it without clearing dueAt. This does not configure a notification. Source-owned calendar windows cannot be edited."), recurrence: recurrence.nullable().optional(),
    aiClientId: creationFields.aiClientId, executionConfig: managementExecutionConfigSchema.optional(),
  }).strict().refine((patch) => Object.keys(patch).length > 0, "patch must not be empty"),
}).strict();

// Reuse public user-action contracts, but the service supplies all idempotency keys.
const publicExecutionOptions = executionActionBodySchema.options.map((option) => {
  const shape: z.ZodRawShape = option.shape;
  const { idempotencyKey: _key, ...publicShape } = shape;
  return z.object(publicShape).strict();
});
const executionInput = z.discriminatedUnion("action", [publicExecutionOptions[0], ...publicExecutionOptions.slice(1)]);
function validateCommand(schema: z.ZodType, input: object, ctx: z.RefinementCtx) {
  const parsed = schema.safeParse({ ...input, idempotencyKey: "management" });
  if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
}
const planPatchInput = z.object(planPatchBodySchema.shape).omit({ idempotencyKey: true }).strict().superRefine((input, ctx) => validateCommand(planPatchBodySchema, input, ctx));
const checkpointInput = z.object(checkpointActionBodySchema.shape).omit({ idempotencyKey: true }).strict().superRefine((input, ctx) => validateCommand(checkpointActionBodySchema, input, ctx));
const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("generate_plan"), forceRefresh: z.boolean().optional(), userInstruction: z.string().max(10_000).optional() }).strict(),
  z.object({ type: z.literal("stop_plan_generation") }).strict(),
  z.object({ type: z.literal("accept_plan"), planId: id, expectedHeadStateVersion: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("patch_plan"), patch: planPatchInput }).strict(),
  z.object({ type: z.literal("execution"), expectedExecutionScope: id.nullable(), input: executionInput }).strict(),
  z.object({ type: z.literal("checkpoint"), checkpointId: id, expectedExecutionScope: id, input: checkpointInput }).strict(),
  z.object({ type: z.literal("provider_approval"), approvalId: id, input: providerApprovalResolveBodySchema.omit({ idempotencyKey: true, workBlockId: true }) }).strict(),
  z.object({ type: z.literal("follow_up"), runId: id, intent: z.enum(["ask", "create_task"]), instruction: z.string().trim().min(1).max(10_000), sessionStrategy: z.enum(["handoff_compact", "fresh_with_result"]).optional() }).strict(),
  z.object({ type: z.literal("retry_result"), expectedExecutionScope: id }).strict(),
  z.object({ type: z.literal("accept_result"), runId: id }).strict(),
  z.object({ type: z.literal("complete"), runId: id }).strict(),
  z.object({ type: z.literal("reopen") }).strict(),
  z.object({ type: z.literal("manual_complete"), expectedRevision: z.string().min(1).max(512) }).strict(),
  z.object({ type: z.literal("manual_reopen"), expectedRevision: z.string().min(1).max(512) }).strict(),
  z.object({ type: z.literal("schedule_proposal"), proposalId: id, decision: z.enum(["Accepted", "Rejected"]), note: z.string().max(2_000).optional() }).strict(),
]);
export const managementActionSchema = z.object({ requestId: z.string().uuid(), taskId: id, workBlockId: id.optional(), action }).strict();
export const managementDeleteSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("preview"), taskId: id }).strict(),
  z.object({ mode: z.literal("delete"), requestId: z.string().uuid(), taskId: id, expectedRevision: z.string().min(1).max(512), expectedTaskIds: z.array(id).min(1).max(1_000), expectedAssetIds: z.array(id).max(1_000) }).strict(),
]);
export const managementTools = {
  chrona_context_read: z.object({}).strict(), chrona_task_search: managementSearchSchema, chrona_task_read: managementReadSchema,
  chrona_task_create: managementCreateSchema, chrona_task_update: managementUpdateSchema,
  chrona_task_action: managementActionSchema, chrona_task_delete: managementDeleteSchema,
  chrona_goal_search: managementGoalSearchSchema, chrona_goal_read: managementGoalReadSchema,
  chrona_goal_propose: managementGoalProposeSchema,
};
export type ManagementToolName = keyof typeof managementTools;
export type ManagementCreate = z.infer<typeof managementCreateSchema>;
export type ManagementUpdate = z.infer<typeof managementUpdateSchema>;
export type ManagementAction = z.infer<typeof managementActionSchema>;
export type ManagementRead = z.infer<typeof managementReadSchema>;
export type ManagementSearch = z.infer<typeof managementSearchSchema>;
export type ManagementDelete = z.infer<typeof managementDeleteSchema>;
