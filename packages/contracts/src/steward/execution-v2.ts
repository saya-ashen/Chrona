import { z } from "zod";
import { executionBaselineSchema, executionCommandSchema, executionIdSchema, executionErrorSchema, executionRefSchema, executionResultSchema, executionStartSchema, executionViewSchema } from "./execution";
import { editorResponseDataSchemas } from "./execution-events";

/** P2 work protocol. v1 execution envelopes and fixtures remain exact. */
export const WORK_PROTOCOL = "chrona.execution.v2" as const;
export const WORK_LIMITS = { children: 20, sourceFiles: 100, sourceBytes: 32_768, requestBytes: 262_144, responseBytes: 262_144, queueMs: 86_400_000 } as const;
const id = executionIdSchema;
const relativePath = z.string().min(1).max(4096).refine(value => !value.startsWith("/") && !value.includes("\\") && !value.includes("\0") && !value.split("/").some(part => part === ".." || part === "." || part === ".git" || !part) && !/^[A-Za-z]:/.test(value), "Expected project relative path");
export const executionSourceSchema = z.object({ files: z.array(z.object({ path: relativePath, sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(WORK_LIMITS.sourceFiles) }).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= WORK_LIMITS.sourceBytes && new Set(value.files.map(file => file.path)).size === value.files.length, "Source manifest exceeds bounds or repeats a path");
export const workPlacementSchema = z.object({ executorId: id, projectRef: id, mappingRevision: z.number().int().positive() }).strict();
export const workBaselineSchema = executionBaselineSchema.refine(value => value.kind !== "commit" || /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.digest), "Commit baseline requires the exact object hash");
export const workWorkspaceRequestSchema = z.object({ mode: z.enum(["existing", "independent_worktree"]), baseline: workBaselineSchema, source: executionSourceSchema.optional() }).strict().refine(value => value.mode !== "independent_worktree" || value.baseline.kind === "commit", "Independent worktree requires an explicit commit");
export const workLeafStartSchema = executionStartSchema.omit({ projectRef: true }).extend({ kind: z.literal("execution"), placement: workPlacementSchema, workspace: workWorkspaceRequestSchema, queueExpiresAt: z.string().datetime({ offset: true }), parentWorkId: id.optional(), dependsOnWorkIds: z.array(id).max(WORK_LIMITS.children).default([]) }).strict();
export const workGroupStartSchema = z.object({ kind: z.literal("group"), workId: id, commandKey: id, goal: z.string().trim().min(1).max(20_000), children: z.array(workLeafStartSchema.omit({ parentWorkId: true })).min(1).max(WORK_LIMITS.children) }).strict().refine(validWorkGraph, "Children require unique identities/keys and an acyclic graph within this parent");
function validWorkGraph(group: { workId: string; commandKey: string; children: { workId: string; commandKey: string; dependsOnWorkIds: string[] }[] }) {
  const nodes = new Map(group.children.map(child => [child.workId, child]));
  if (nodes.size !== group.children.length || nodes.has(group.workId) || new Set([group.commandKey, ...group.children.map(child => child.commandKey)]).size !== group.children.length + 1) return false;
  const visiting = new Set<string>(), done = new Set<string>();
  const visit = (workId: string): boolean => {
    if (visiting.has(workId)) return false;
    if (done.has(workId)) return true;
    const child = nodes.get(workId);
    if (!child || new Set(child.dependsOnWorkIds).size !== child.dependsOnWorkIds.length) return false;
    visiting.add(workId);
    if (!child.dependsOnWorkIds.every(visit)) return false;
    visiting.delete(workId); done.add(workId); return true;
  };
  return group.children.every(child => visit(child.workId));
}
export const workStartSchema = z.discriminatedUnion("kind", [workLeafStartSchema, workGroupStartSchema]).refine(value => value.kind === "group" || (value.parentWorkId === undefined && value.dependsOnWorkIds.length === 0), "Independent leaves cannot attach to an existing parent");
export const workLocationSchema = workPlacementSchema.extend({ label: z.string().min(1).max(200), kind: z.enum(["server", "device"]), online: z.boolean(), baseline: workBaselineSchema, workspaceModes: z.array(z.enum(["existing", "independent_worktree"])).min(1).max(2) }).strict();
export const executionSourceReceiptSchema = z.object({ placement: workPlacementSchema, baseline: workBaselineSchema, manifestDigest: z.string().regex(/^[a-f0-9]{64}$/), fileCount: z.number().int().min(1).max(WORK_LIMITS.sourceFiles), verifiedAt: z.string().datetime({ offset: true }), stage: z.literal("claim") }).strict();
export const workWorkspaceSchema = z.object({ workspaceRef: id, mode: z.enum(["existing", "independent_worktree"]), baseline: workBaselineSchema, state: z.enum(["requested", "ready", "failed", "retained", "removed", "unknown"]), sourceReceipt: executionSourceReceiptSchema.nullable(), retained: z.boolean() }).strict().refine(value => value.sourceReceipt === null || (value.sourceReceipt.baseline.kind === value.baseline.kind && value.sourceReceipt.baseline.digest === value.baseline.digest), "Workspace source receipt baseline mismatch");
export const workViewSchema = z.object({ workId: id, kind: z.enum(["execution", "group"]), goal: z.string().max(20_000), parentWorkId: id.nullable(), children: z.array(id).max(WORK_LIMITS.children), dependsOnWorkIds: z.array(id).max(WORK_LIMITS.children), blockedBy: z.array(id).max(WORK_LIMITS.children), dependencyResults: z.array(executionRefSchema.extend({ resultId: id, artifactRef: id, baseline: executionBaselineSchema }).strict()).max(WORK_LIMITS.children), queueExpiresAt: z.string().datetime({ offset: true }).nullable(), phase: z.enum(["waiting_dependency", "waiting_device", "queued", "running", "stopping", "unknown", "completed", "failed", "cancelled"]), cancelRequested: z.boolean(), placement: workPlacementSchema.nullable(), workspace: workWorkspaceSchema.nullable(), execution: executionViewSchema.nullable() }).strict().refine(value => value.kind === "group"
  ? value.execution === null && value.placement === null && value.workspace === null && value.queueExpiresAt === null && value.parentWorkId === null
  : value.placement !== null && value.queueExpiresAt !== null && value.children.length === 0 && (value.execution === null || value.execution.workId === value.workId), "Work projection identities disagree")
  .refine(value => !value.workspace?.sourceReceipt || JSON.stringify(value.workspace.sourceReceipt.placement) === JSON.stringify(value.placement), "Work source receipt placement mismatch");
const [, get, lookupStart, , send, answer, , attach, detach, events, snapshot, results, accept] = executionCommandSchema.options;
export const workCommandSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("start"), input: workStartSchema }).strict(),
  get, lookupStart,
  z.object({ op: z.literal("list"), resource: z.enum(["works", "locations"]).default("works"), parentWorkId: id.optional(), after: id.optional(), limit: z.number().int().min(1).max(100) }).strict(),
  send, answer,
  z.object({ op: z.literal("cancel"), workId: id, commandKey: id, runId: id.optional(), attemptId: id.optional() }).strict().refine(value => (value.runId === undefined) === (value.attemptId === undefined), "Both execution identifiers are required together"),
  attach, detach, events, snapshot, results, accept,
]);
export const workRequestSchema = z.object({ v: z.literal(WORK_PROTOCOL), requestId: id, command: workCommandSchema }).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= WORK_LIMITS.requestBytes, "Work request exceeds byte budget");
export const workResultsSchema = z.object({ results: z.array(executionResultSchema).max(100), missing: z.array(id).max(WORK_LIMITS.children) }).strict();
export const workCleanupInputSchema = z.discriminatedUnion("action", [
  z.object({ workId: id, commandKey: id, action: z.literal("preview") }).strict(),
  z.object({ workId: id, commandKey: id, action: z.literal("confirm"), previewDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
export const workCleanupReceiptSchema = z.object({ workId: id, workspaceRef: id, state: z.enum(["retained", "blocked", "removed", "unknown"]), reason: z.string().max(500), previewDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict();
export const workResponseDataSchemas = {
  start: workViewSchema, get: workViewSchema, lookup_start: workViewSchema,
  list: z.union([z.object({ resource: z.literal("works"), works: z.array(workViewSchema).max(100), after: id.nullable() }).strict(), z.object({ resource: z.literal("locations"), locations: z.array(workLocationSchema).max(100), after: id.nullable() }).strict()]),
  send: editorResponseDataSchemas.send, answer: editorResponseDataSchemas.answer, cancel: workViewSchema, attach: workViewSchema,
  detach: editorResponseDataSchemas.detach, events: editorResponseDataSchemas.events, snapshot: editorResponseDataSchemas.snapshot,
  results: workResultsSchema, accept: editorResponseDataSchemas.accept,
} as const;
export const workResponseEnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({ v: z.literal(WORK_PROTOCOL), requestId: id, ok: z.literal(true), data: z.union([workResponseDataSchemas.start, workResponseDataSchemas.list, workResponseDataSchemas.send, workResponseDataSchemas.events, workResponseDataSchemas.snapshot, workResponseDataSchemas.results, workResponseDataSchemas.accept]) }).strict(),
  z.object({ v: z.literal(WORK_PROTOCOL), requestId: id, ok: z.literal(false), error: executionErrorSchema }).strict(),
]).refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= WORK_LIMITS.responseBytes, "Work response exceeds byte budget");
/** All v2 operations, including events, use this path; there is no v2 GET fallback. */
export const WORK_HTTP = { method: "POST", commands: "/api/editor/v1/commands" } as const;
export type WorkRequest = z.infer<typeof workRequestSchema>;
/** Parse each response once against its originating op, then bind correlation and execution identity. */
export function parseWorkResponse(request: WorkRequest, raw: unknown) {
  const response = z.discriminatedUnion("ok", [
    z.object({ v: z.literal(WORK_PROTOCOL), requestId: z.literal(request.requestId), ok: z.literal(true), data: workResponseDataSchemas[request.command.op] }).strict(),
    z.object({ v: z.literal(WORK_PROTOCOL), requestId: z.literal(request.requestId), ok: z.literal(false), error: executionErrorSchema }).strict(),
  ]).refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= WORK_LIMITS.responseBytes, "Work response exceeds byte budget").parse(raw);
  if (!response.ok) return response;
  validateWorkResponseIdentity(request.command, response.data);
  return response;
}
type WorkResponseData = z.infer<(typeof workResponseDataSchemas)[keyof typeof workResponseDataSchemas]>;
function sameExecutionTarget(expected: { workId: string; runId: string; attemptId: string }, actual: { workId: string; runId: string; attemptId: string }) {
  return expected.workId === actual.workId && expected.runId === actual.runId && expected.attemptId === actual.attemptId;
}
/** Work projections and execution details have different identities; neither can be installed as the other. */
function validateWorkResponseIdentity(command: WorkCommand, data: WorkResponseData) {
  if ("kind" in data) {
    const expected = command.op === "start" ? command.input.workId : "workId" in command ? command.workId : undefined;
    if (expected !== undefined && data.workId !== expected) throw new Error("Work identity mismatch");
  }
  validateExecutionResponseIdentity(command, data);
}
function validateExecutionResponseIdentity(command: WorkCommand, data: WorkResponseData) {
  if (command.op === "snapshot" && "runId" in data && !sameExecutionTarget(command, data)) throw new Error("Snapshot identity mismatch");
  if (command.op === "events" && "events" in data && !data.events.every(event => sameExecutionTarget(command, event))) throw new Error("Event identity mismatch");
  if (command.op === "list" && "resource" in data && data.resource !== command.resource) throw new Error("List resource mismatch");
}
export type WorkStart = z.infer<typeof workStartSchema>;
export type WorkLeafStart = z.infer<typeof workLeafStartSchema>;
export type WorkView = z.infer<typeof workViewSchema>;
export type WorkLocation = z.infer<typeof workLocationSchema>;
export type WorkCommand = z.infer<typeof workCommandSchema>;
export type WorkPlacement = z.infer<typeof workPlacementSchema>;
export type WorkWorkspace = z.infer<typeof workWorkspaceSchema>;
export type ExecutionSource = z.infer<typeof executionSourceSchema>;
export type WorkCommandConsumer = { [K in WorkCommand["op"]]: (input: Omit<Extract<WorkCommand, { op: K }>, "op">) => Promise<z.infer<(typeof workResponseDataSchemas)[K]>> };
/** Kernel internal admission operates on a leaf; parent/dependency organization belongs to coding. */
export const executionStartV2Schema = workLeafStartSchema.omit({ parentWorkId: true, dependsOnWorkIds: true });
export const executionPlacementViewSchema = executionRefSchema.extend({ placement: workPlacementSchema, workspace: workWorkspaceSchema, queueExpiresAt: z.string().datetime({ offset: true }), online: z.boolean() }).strict();
export type ExecutionStartV2 = z.infer<typeof executionStartV2Schema>;
export type ExecutionPlacementView = z.infer<typeof executionPlacementViewSchema>;
export type ExecutionSourceReceipt = z.infer<typeof executionSourceReceiptSchema>;
export type WorkCleanupInput = z.infer<typeof workCleanupInputSchema>;
export type WorkCleanupReceipt = z.infer<typeof workCleanupReceiptSchema>;
