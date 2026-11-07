import { z } from "zod";
import type { Proposal } from "./module-context";
import type { moduleUpstream } from "./module-upstream";
import { moduleHealthSummarySchema } from "./module-diagnostics";
import { appSchema, approvalSchema, attachmentSchema, chatReplySchema, grantSchema, memorySettingsSchema, messageSchema, preferenceSchema, providerRunViewSchema, scheduleSchema, sessionSchema, settingsSchema, todayViewSchema, healthSchema, APPROVAL_STATUSES } from "@chrona/contracts/steward";
import { moduleOverviewOutputSchema, permissionsSchema } from "./module-overview";

export const ownerBuildOutput = z.object({ status: z.string(), sessionId: z.string(), runId: z.string(), duplicate: z.boolean(), queuePosition: z.number().optional(), aheadCount: z.number().optional(), waitUntil: z.string().nullable().optional() });
export const okOutput = z.object({ ok: z.literal(true) });
export const chatConversationStateOutput = z.object({ now: z.string(), limits: z.object({ idleMinutes: z.number(), minContextTokens: z.number(), maxContextTokens: z.number() }),
  session: z.object({ id: z.string(), title: z.string().nullable(), lastActivityAt: z.string(), busy: z.boolean(), contextTokens: z.number() }).nullable() });
export const chatSendOutput = z.object({ sessionId: z.string(), messageId: z.string(), runId: z.string().nullable() });
// Small images come back inline (base64) so chat.send can hand them to the model.
export const chatAttachOutput = attachmentSchema.extend({ base64: z.string().optional() });
export const chatSessionOutput = sessionSchema;
export const chatFileOutput = z.object({ base64: z.string(), mime: z.string() });
export const chatAskOutput = chatReplySchema;
export const chatSessionsOutput = z.array(sessionSchema);
export const chatTodayOutput = todayViewSchema;
export const chatRuntimeOutput = healthSchema.omit({ queuedNotifications: true, failedNotifications: true }).extend({ at: z.string().datetime() });
export const chatMessagesOutput = z.array(messageSchema);
export const chatRunsOutput = z.array(providerRunViewSchema);
export const chatTranscriptOutput = z.array(z.discriminatedUnion("kind", [
  z.object({ at: z.string(), kind: z.literal("text"), text: z.string() }),
  z.object({ at: z.string(), kind: z.literal("tool"), tool: z.string(), args: z.string() }),
  z.object({ at: z.string(), kind: z.literal("result"), tool: z.string(), text: z.string(), error: z.boolean() }),
]));
export const approvalsListOutput = z.array(approvalSchema);
export const approvalOutput = approvalSchema;
export const approvalRequestOutput = z.object({ approval: z.string(), decision: z.enum(["approved", "denied"]) });
export const approvalStatusOutput = z.object({ approval: z.string(), status: z.enum(APPROVAL_STATUSES), hash: z.string(), resolvedAt: z.string().nullable() });
export const modulesListOutput = z.array(appSchema.extend({
  workspaceId: z.string(), dataSchema: z.number().nullable(), createdAt: z.string(), versionCount: z.number().int().optional(),
  health: moduleHealthSummarySchema,
  versions: z.array(z.object({ hash: z.string(), status: z.string(), intent: z.json(), createdAt: z.string(), errors: z.array(z.string()).nullable(),
    git: z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/), tree: z.string().regex(/^[a-f0-9]{40}$/) }).nullable().default(null) })),
  runs: z.array(z.object({ id: z.string(), hash: z.string(), triggerId: z.string(), firedAt: z.string(), exitCode: z.number(), error: z.string().nullable(), createdAt: z.string() })),
}));
// Overview's service imports the system registry; defer schema reuse until that registry is initialized.
export const modulesSystemOutput = z.lazy(() => {
  const app = moduleOverviewOutputSchema.options[1].omit({ kind: true, settings: true, activity: true });
  return z.union([z.array(app.omit({ work: true })), app]);
});
export const modulesPermissionsOutput = z.lazy(() => permissionsSchema);
const toolExampleOutput = z.object({ description: z.string().optional(), args: z.record(z.string(), z.json()), result: z.json().optional() });
const toolErrorOutput = z.object({ code: z.string(), description: z.string(), recovery: z.string() });
export const modulesToolsOutput = z.array(z.object({ moduleId: z.string().optional(), hash: z.string().optional(), contractHash: z.string().optional(), target: z.string(), description: z.string(), inputSchema: z.record(z.string(), z.json()), outputSchema: z.json().nullable(), examples: z.array(toolExampleOutput).nullable(), sideEffects: z.array(z.string()).nullable(), errors: z.array(toolErrorOutput).nullable(), retry: z.string(), idempotent: z.boolean() }));
export const modulesContributionsOutput = z.array(z.object({ module: z.string(), hash: z.string(), value: z.json() }));
const gitCommitOutput = z.string().regex(/^[a-f0-9]{40}$/);
const buildTestOutput = z.object({ stdout: z.string(), stderr: z.string(), exitCode: z.number() }).strict();
const typecheckErrorOutput = z.object({ file: z.string(), line: z.number(), code: z.number(), message: z.string() }).strict();
const buildStatusOutput = z.enum(["passed", "failed", "skipped"]);
const proposalOutput = z.object({
  moduleId: z.string().nullable(), hash: gitCommitOutput, status: z.enum(["building", "testing", "rejected", "pending_review", "approved"]), approvalId: z.string().optional(),
  report: z.object({
    tests: z.array(buildTestOutput), git: z.object({ commit: gitCommitOutput, tree: gitCommitOutput }).strict().optional(),
    continuity: z.object({ status: buildStatusOutput, reason: z.string().optional(), fromSchema: z.number().nullable(), toSchema: z.number(), migrated: z.boolean(),
      effects: z.array(z.discriminatedUnion("type", [
        z.object({ type: z.literal("notify_user"), key: z.string(), level: z.enum(["now", "digest"]), title: z.string(), body: z.string() }).strict(),
        z.object({ type: z.literal("wake_provider"), key: z.string(), prompt: z.string() }).strict(),
      ])).optional(), migration: buildTestOutput.optional(), output: buildTestOutput.optional() }).strict().optional(),
    keyProbe: z.object({ status: z.enum(["passed", "repeated", "skipped"]), reason: z.string().optional(), keys: z.array(z.string()).optional() }).strict().optional(),
    migration: buildTestOutput.optional(), errors: z.array(z.string()).optional(),
    typecheck: z.object({ status: buildStatusOutput, reason: z.string().optional(), errors: z.array(typecheckErrorOutput).optional(), total: z.number().optional() }).strict().optional(),
    outputImpacts: z.array(z.object({ caller: z.string(), targets: z.array(z.string()) }).strict()).optional(),
    dependentChecks: z.array(z.object({ caller: z.string(), status: buildStatusOutput, reason: z.string().optional(), errors: z.array(typecheckErrorOutput).optional() }).strict()).optional(),
    dependencies: z.object({ npm: z.boolean(), python: z.boolean(), packages: z.record(z.string(), z.array(z.string())) }).strict().optional(),
  }).strict(),
}).strict() satisfies z.ZodType<Proposal>;
export const modulesUpstreamOutput = z.object({
  moduleId: z.string(), repository: z.string().nullable(), branch: z.string().nullable(), localCommit: gitCommitOutput.nullable(), fetchedCommit: gitCommitOutput.nullable(), proposal: proposalOutput.nullable(),
}).strict() satisfies z.ZodType<Awaited<ReturnType<typeof moduleUpstream>>>;
export const modulesCheckOutput = z.object({ module: z.string(), hash: z.string(), status: z.string(), active: z.boolean(), report: z.json() });
export const modulesRollbackOutput = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending_approval"), approvalId: z.string() }),
  z.object({ status: z.literal("active"), moduleId: z.string(), activeHash: z.string() }),
]);
/** v2-26 `modules.disable/enable`: done (the user) or asked (Chrona). */
export const modulesStatusOutput = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending_approval"), approvalId: z.string() }),
  z.object({ status: z.enum(["paused", "active"]), moduleId: z.string() }),
]);
export const buildControlOutput = z.discriminatedUnion("status", [
  z.object({ status: z.literal("build_stopped"), sessionId: z.string() }),
  z.object({ status: z.literal("build_revised"), sessionId: z.string(), runId: z.string(), queuePosition: z.number().optional(), aheadCount: z.number().optional(), waitUntil: z.string().nullable().optional() }),
]);
export const settingsOutput = settingsSchema;
export const settingsGrantsOutput = z.array(grantSchema);
export const settingsGrantOutput = grantSchema;
export const settingsPreferencesOutput = z.array(preferenceSchema);
// The preference deletion service returns undefined; json(undefined) becomes null.
export const settingsForgetOutput = z.null();
export const schedulesListOutput = z.array(scheduleSchema);
export const scheduleOutput = scheduleSchema;
export const scheduleTimerOutput = z.array(scheduleSchema.extend({ key: z.string(), payload: z.record(z.string(), z.json()) }));
export const scheduleCancelOutput = z.object({ cancelled: z.boolean() });
export const providerCompleteOutput = z.object({ text: z.string(), inputTokens: z.number().nullable(), outputTokens: z.number().nullable() });
export const providerWakeOutput = z.object({ sessionId: z.string() });
export const secretGetOutput = z.object({ value: z.record(z.string(), z.string()) });
export const secretSetOutput = z.object({ name: z.string(), configured: z.literal(true) });
export const secretRemoveOutput = z.object({ name: z.string(), configured: z.boolean() });
export const secretAuthorizeOutput = z.object({ url: z.string(), redirectUri: z.string(), expiresAt: z.string() });
export const secretTokenOutput = z.object({ accessToken: z.string(), expiresAt: z.string() });
export const secretsListOutput = z.array(z.object({ name: z.string(), configured: z.boolean(), updatedAt: z.string().nullable(), modules: z.array(z.string()) }));
export const activityListOutput = z.lazy(() => z.object({ items: z.array(moduleOverviewOutputSchema.options[1].shape.activity.element), before: z.string().nullable() }));
export const memoryRecallOutput = z.object({ items: z.array(z.object({ id: z.string(), content: z.string(), at: z.string().optional() })) });
// These two results are forwarded unchanged from the user-selected memory provider.
export const memoryRetainOutput = z.json();
export const memoryForgetOutput = z.json();
export const memoryStatusOutput = memorySettingsSchema.extend({ available: z.boolean(), last24h: z.object({ retained: z.number(), recalled: z.number(), forgotten: z.number() }) });
export const contentReadOutput = z.object({ ref: z.string(), name: z.string(), mime: z.string(), bytes: z.number().int(), sha256: z.string(), base64: z.string() });
