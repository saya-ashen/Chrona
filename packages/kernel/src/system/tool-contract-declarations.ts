import { z } from "zod";
import { kernelAgentInputs, kernelAgentOutputs, APPROVAL_STATUSES, settingsSchema as kernelSettingsSchema, candidateAdmissionInputSchema, candidateAdmissionOutputSchema, candidateSourceInputSchema, candidateSourceOutputSchema, candidateSubmitInputSchema, candidateSubmitOutputSchema, candidateCheckOutputSchema, modulesToolInputSchemas, pageInput, pageOutput, timerSetInput, timerViewSchema, lifecycleOperationSchema, updateSettingsSchema } from "@chrona/contracts/steward";
import * as outputs from "./system-outputs";
import { moduleDiagnosticsOutputSchema, moduleHealthSummarySchema } from "../modules/module-diagnostics";
import { activityRecordsOutput } from "../activity";
import { kernelFactSchema } from "../notification-facts";
import { tool, text, declaredSystemTools } from "./tool-declaration";

export const consumerInput = z.object({ moduleId: z.string().min(1).nullable().optional() }).strict();
export const ackInput = z.object({ revision: z.string().min(1), ids: z.array(z.string().min(1)).min(1).max(100) }).strict();
export const withdrawalsInput = z.object({ revision: z.string().min(1), keys: z.array(z.string().max(4000)).min(1).max(100) }).strict();
const consumerOutput = z.object({ moduleId: z.string().nullable(), revision: z.string() });

const readers = ["modules", "owner", "provider"] as const;
const agentGuidance: Record<keyof typeof kernelAgentInputs, string> = {
  register: "Register this caller's Provider declaration.",
  providers: "Discover available Providers and their capabilities before selecting one.",
  run: "Accept a caller-owned Run and return its identity without waiting for model completion. Persist the call key and exact arguments before sending; recover a lost response with the same key and arguments. Read progress with agent.read.",
  read: "Read one owned Run. Drain nextCursor even when ended is true; ended describes execution, not pagination. Normalized transcript is a bounded snapshot, not an append-only delta.",
  write: "Submit input to an owned Run with a stable call key. A repeated key cannot repeat the effect; an unresolved control outcome remains unknown. Preserve the original request and reconcile the Run rather than inventing another key.",
  stop: "Request cancellation of an owned Run with a stable call key. Keep a pending stop occupied until stopConfirmed is true; agent.read exposes active/unknown status but no stopConfirmed field. Acknowledgement alone is not proof of termination.",
  native: "Invoke the selected Provider's native interface for an owned Run. Preserve the exact request and key; an unresolved outcome must not be replayed under a new key.",
};

/** Shared build source and runtime validators; importing declarations never registers handlers. */
export const publicSystemTools = {
  agent: declaredSystemTools("agent", Object.keys(kernelAgentInputs).map(name => {
    const key = name as keyof typeof kernelAgentInputs;
    return tool(key, `Kernel Agent ${key}. ${agentGuidance[key]} Call synchronously (mode: sync); mode: async is unsupported. callStatus can observe a keyed synchronous invocation receipt, not live Run progress or new stop evidence. Provider identity and Run ownership are checked by the kernel.`, {}, [], {
      visibility: key === "providers" ? ["modules", "owner"] : ["modules"],
      idempotent: ["register", "providers", "read"].includes(key), input: kernelAgentInputs[key], output: kernelAgentOutputs[key],
    });
  })),
  activity: declaredSystemTools("activity", [
    tool("runtime", "Runtime health facts without application presentation.", {}, [], { idempotent: true, visibility: ["modules", "owner"], output: z.lazy(() => outputs.runtimeOutput) }),
    tool("runs", "Bounded execution status, progress, usage and pending interactions. Read-only runtime facts; no transcript or execution authority.", { session: text("Optional exact session id") }, [], { idempotent: true, visibility: ["modules", "owner"], input: pageInput.extend({ sessionId: z.string().optional() }), output: z.lazy(() => pageOutput(outputs.runsOutput.element)) }),
    tool("records", "Bounded workspace audit facts, ordered by timestamp and identity. Only allowlisted metadata; never raw details or credential values.", { before: text("ISO time from the previous page") }, [], { idempotent: true, visibility: ["modules", "owner"], input: pageInput, output: pageOutput(activityRecordsOutput.shape.rows.element) }),
    tool("usage", "Application completion reservations, reported tokens, unreported call counts and timer usage for the current governance day. Excludes total Provider session cost; per-run reports are in activity.runs.", {}, [], { idempotent: true, visibility: ["modules", "owner"], input: pageInput, output: pageOutput(z.object({ moduleId: z.string().nullable(), module: z.string(), calls: z.number(), inputTokens: z.number(), outputTokens: z.number(), unreportedCalls: z.number().int().nonnegative(), wakes: z.number(), date: z.string(), timezone: z.string() }).strict()) }),
    tool("consumer", "Owner selects one active application id to consume kernel facts, or null for none. Pause the previous consumer before switching. Omit module to read the selection. Confirmed facts never replay on a switch.", {}, [], { visibility: ["owner"], input: consumerInput, output: consumerOutput }),
    tool("facts", "Selected application only: up to 50 pending finite kernel facts. Persist privately, then acknowledge before delivery. Not a generic audit or invocation dump.", {}, [], { idempotent: true, visibility: ["modules"], output: z.object({ revision: z.string(), facts: z.array(z.intersection(z.object({ id: z.string(), at: z.string().datetime() }), kernelFactSchema)).max(50) }) }),
    tool("withdrawals", "Selected application only: reconcile up to 100 private notification keys against durable withdrawals, including withdrawals consumed by another application. Check queued notifications before delivery after recovery or selection changes.", {}, [], { idempotent: true, visibility: ["modules"], input: withdrawalsInput, output: z.object({ withdrawn: z.array(z.string()).max(100) }) }),
    tool("ack", "Selected application only: acknowledge durable private ingestion under the current selection revision. Returns ids consumed by this application, including repeats; ids consumed by another application are excluded.", {}, [], { idempotent: true, visibility: ["modules"], input: ackInput, output: z.object({ acknowledged: z.array(z.string()).max(100) }) }),
  ]),
  approvals: declaredSystemTools("approvals", [
    tool("list", "Approvals, by status (default open).", { status: { type: "string", enum: [...APPROVAL_STATUSES] } }, [], { visibility: ["owner"], idempotent: true, input: pageInput.extend({ status: z.enum(APPROVAL_STATUSES).optional() }), output: z.lazy(() => pageOutput(outputs.approvalsListOutput.element)) }),
    tool("resolve", "Approve or deny an approval as the user (only after the user decided).", { approval: text(), decision: { type: "string", enum: ["approve", "deny"] } }, ["approval", "decision"], { visibility: ["owner"], output: z.lazy(() => outputs.approvalOutput) }),
    tool("request", "Ask the user to decide something this module is about to do (v2-16). Call asynchronously with reply: the call waits, and its call_result carries { approval, decision: approved | denied }. Approved once, never standing.",
      { title: text("What the user decides, e.g. 开始模拟实验"), detail: text("Why, and what follows"), preview: text("Exactly what will be done") }, ["title"], { idempotent: true, output: z.lazy(() => outputs.approvalRequestOutput) }),
    tool("status", "A request this module made: { status, hash, resolvedAt }.", { approval: text() }, ["approval"], { idempotent: true, output: z.lazy(() => outputs.approvalStatusOutput) }),
  ]),
  modules: declaredSystemTools("modules", [
    tool("list", "Installed applications and current versions.", {}, [], { idempotent: true, visibility: [...readers], input: pageInput, output: pageOutput(outputs.modulesListOutput.element) }),
    tool("describe", "Discover reachable contracts or inspect one exact target.", {}, [], { idempotent: true, visibility: [...readers], input: modulesToolInputSchemas.describe, output: z.union([pageOutput(outputs.modulesToolsOutput.element), outputs.modulesReferenceOutput.options[1]]) }),
    tool("health", "Observed runtime and fault evidence; no business probes.", {}, [], { idempotent: true, visibility: [...readers], input: pageInput.extend({ moduleId: z.string().optional(), detail: z.boolean().default(false) }), output: pageOutput(z.union([moduleDiagnosticsOutputSchema.element, moduleHealthSummarySchema])) }),
    tool("admit", "Admit one exact submitter and application baseline; no model authority.", {}, [], { idempotent: true, visibility: ["owner"], input: z.object({ submitter: candidateAdmissionInputSchema.shape.submitter, target: candidateAdmissionInputSchema.shape.target }).strict(), output: candidateAdmissionOutputSchema }),
    tool("source", "Export the admitted exact version into the submitter's content.", {}, [], { idempotent: true, visibility: ["modules"], input: candidateSourceInputSchema, output: candidateSourceOutputSchema }),
    tool("submit", "Freeze one application material under a durable receipt.", {}, [], { idempotent: true, visibility: ["modules"], input: z.object({ admissionId: candidateSubmitInputSchema.shape.admissionId, item: candidateSubmitInputSchema.shape.item }).strict(), output: candidateSubmitOutputSchema }),
    tool("receipt", "Read one exact candidate receipt, never latest.", {}, [], { idempotent: true, visibility: ["modules", "owner"], input: z.union([z.object({ receiptId: z.string() }).strict(), z.object({ admissionId: z.string(), key: z.string() }).strict(), z.object({ admissionId: z.string(), requestKey: z.string() }).strict()]), output: candidateCheckOutputSchema }),
    ...(["enable", "disable", "rollback", "remove"] as const).map(name => tool(name, `Governed application ${name}.`, {}, [], { visibility: ["owner"], input: z.object({ moduleId: z.string().min(1), reason: z.string().min(1), ...(name === "rollback" ? { hash: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/) } : {}) }).strict(), output: lifecycleOperationSchema })),
    tool("operation", "Read the durable result of a lifecycle operation.", {}, [], { idempotent: true, visibility: ["owner"], input: z.union([z.object({ operationId: z.string() }).strict(), z.object({ moduleId: z.string(), action: z.enum(["enable", "disable", "rollback", "remove"]), key: z.string() }).strict()]), output: lifecycleOperationSchema }),
  ]),
  timers: declaredSystemTools("timers", [
    tool("set", "Set or replace the caller's persistent timer.", {}, [], { idempotent: true, input: timerSetInput, output: timerViewSchema }),
    tool("cancel", "Cancel the caller's timer; cannot undo effects already started.", {}, [], { idempotent: true, input: z.object({ id: z.string().min(1).max(120) }).strict(), output: z.object({ id: z.string(), status: z.literal("cancelled") }).strict() }),
    tool("list", "List the caller's timers.", {}, [], { idempotent: true, input: pageInput, output: pageOutput(timerViewSchema) }),
  ]),
  secrets: declaredSystemTools("secrets", [
    tool("get", "A credential this module lists in its manifest's secrets.", { name: text() }, ["name"], { idempotent: true, output: z.lazy(() => outputs.secretGetOutput) }),
    tool("set", "Save a credential the user entered (owners): value is a JSON object of string fields; never returned. merge: keep the saved fields not in value (the page); otherwise the whole credential is replaced.", { name: text(), value: { type: "object", properties: {}, additionalProperties: true }, merge: { type: "boolean" } }, ["name", "value"], { visibility: ["owner"], input: z.object({ name: z.string(), value: z.record(z.string(), z.string()), merge: z.boolean().optional() }).strict(), output: z.lazy(() => outputs.secretSetOutput) }),
    tool("remove", "Delete a saved credential, or only its field (owners), e.g. one account's password or OAuth authorization (refreshToken_<account>).", { name: text(), field: text("One field to delete") }, ["name"], { visibility: ["owner"], output: z.lazy(() => outputs.secretRemoveOutput) }),
    tool("list", "Saved credentials (name, update time) and the active modules declaring each (owners); never values.", {}, [], { visibility: ["owner"], idempotent: true, input: pageInput, output: z.lazy(() => pageOutput(outputs.secretsListOutput.element)) }),
    tool("authorize", "Start OAuth for a credential this module declares (v2-30 §4; checked owners: an active module's approved OAuth definition). The credential must already hold clientId (and clientSecret) saved by the user; the provider app must list redirectUri. Give url to the user: they consent on the provider's page and the kernel saves the refresh token. scopes: array of strings; account: one of several accounts under one app.",
      { name: text(), provider: text("google | microsoft"), scopes: { type: "array", items: { type: "string" } }, account: text("Optional account key") }, ["name", "provider", "scopes"], { output: z.lazy(() => outputs.secretAuthorizeOutput) }),
    tool("token", "A short-lived OAuth access token for a credential this module declares, refreshed by the kernel; error reauthorize when the user must authorize again. Never log, store or return it.",
      { name: text(), provider: text("google | microsoft"), account: text("Optional account key") }, ["name", "provider"], { idempotent: true, output: z.lazy(() => outputs.secretTokenOutput) }),
  ]),
  settings: declaredSystemTools("settings", [
    tool("get", "Model budgets, wake budgets, optional task timeout and governance timezone.", {}, [], { idempotent: true, output: z.lazy(() => kernelSettingsSchema) }),
    tool("update", "Update kernel governance only.", {}, [], { visibility: ["owner"], idempotent: true, input: updateSettingsSchema, output: z.lazy(() => kernelSettingsSchema) }),
  ]),
};
