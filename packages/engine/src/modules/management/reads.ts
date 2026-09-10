/* eslint-disable complexity -- Each public view uses an explicit allowlist, never raw provider/runtime records. */
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AUTOMATION_TIMING_PRESETS } from "@chrona/contracts";
import { TASK_FILTER_STATUS_MAP, managementExecutionConfigSchema, type ManagementRead, type ManagementSearch } from "@chrona/contracts/api";
import { resolveExecutionScope } from "../plan-execution/persistence/execution-scope";
import { resolveTaskExecutionProviderSelection } from "../ai";
import type { ManagementIdentity } from "./clients";
import { ManagementError } from "./errors";
import { readExistingExecution } from "./execution-read";
import { deriveManagementWorkState, managementResultFinalization } from "./result-state";
import { managementResultArtifacts } from "./result-artifacts";
import { aiArtifactRef } from "../plan-execution/use-cases/register-generated-plan-output-artifacts";

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function text(value: unknown, max = 500) { return typeof value === "string" ? value.slice(0, max) : null; }
export const taskUrl = (client: ManagementIdentity, id: string) => new URL(`/tasks/${encodeURIComponent(id)}`, client.publicUrl).href;
export const configRevision = (revision: number) => `config-v1:${revision}`;
export function requireScopes(client: ManagementIdentity, scopes: string[]) {
  const missing = scopes.filter((scope) => !(client.scopes as string[]).includes(scope));
  if (missing.length) throw new ManagementError("FORBIDDEN", "Client lacks the required permissions", { missingScopes: missing });
}
export async function scopedTask(client: ManagementIdentity, taskId: string, workBlockId?: string) {
  const task = await db.task.findFirst({ where: { id: taskId, workspaceId: client.workspaceId }, include: { projection: true, importedCalendarEvents: { take: 1, select: { id: true } } } });
  if (!task) throw new ManagementError("NOT_FOUND", "Task not found");
  if (workBlockId && !(await db.workBlock.findFirst({ where: { id: workBlockId, taskId }, select: { id: true } }))) throw new ManagementError("NOT_FOUND", "Work block not found");
  return task;
}
export function assertRevision(task: { configRevision: number }, expected: string) {
  if (configRevision(task.configRevision) !== expected) throw new ManagementError("REVISION_CONFLICT", "Task configuration changed. Read it before deciding how to retry.");
}
function pageInfo(total: number, page = 1, pageSize = 10) {
  return { total, page, pageSize, hasMore: page * pageSize < total && page < 1_000, paginationLimitReached: page === 1_000 && page * pageSize < total };
}
export async function readManagementContext(client: ManagementIdentity) {
  const clients = await db.aiClient.findMany({ select: { id: true, name: true, type: true, enabled: true, isDefault: true }, orderBy: { createdAt: "asc" }, take: 100 });
  const selected = await resolveTaskExecutionProviderSelection({});
  return {
    now: new Date().toISOString(), timezone: client.timezone,
    defaults: { mode: client.defaultMode, source: "explicit_client_setup", aiClientId: selected?.clientId ?? null },
    scopes: client.scopes, aiClients: clients, timing: AUTOMATION_TIMING_PRESETS,
    capabilities: { modes: ["todo", "plan", "automatic"], immediateExecution: true, scheduledExecution: true, recurrenceTimezones: ["UTC"], rawProviderConfig: false },
  };
}
export async function searchManagementTasks(client: ManagementIdentity, input: ManagementSearch) {
  const statuses = input.status ? [input.status] : input.filter && input.filter !== "all" ? [...TASK_FILTER_STATUS_MAP[input.filter]] : undefined;
  const where: Prisma.TaskWhereInput = { workspaceId: client.workspaceId, status: statuses ? { in: statuses } : undefined, priority: input.priority,
    ...(input.query ? { OR: [{ title: { contains: input.query } }, { description: { contains: input.query } }] } : {}) };
  const order: Prisma.TaskOrderByWithRelationInput = input.sort === "dueAt" ? { dueAt: { sort: input.order, nulls: "last" } } : { [input.sort]: input.order };
  const [rows, total] = await Promise.all([
    db.task.findMany({ where, orderBy: [order, { id: "asc" }], take: input.pageSize, skip: (input.page - 1) * input.pageSize,
      select: { id: true, title: true, description: true, status: true, priority: true, kind: true, dueAt: true, updatedAt: true,
        projection: { select: { displayState: true, actionRequired: true } } } }), db.task.count({ where }),
  ]);
  return { ...pageInfo(total, input.page, input.pageSize), items: rows.map((task) => ({
    taskId: task.id, title: text(task.title, 200), titleTruncated: task.title.length > 200,
    descriptionPreview: text(task.description, 200), descriptionTruncated: (task.description?.length ?? 0) > 200,
    status: task.status, priority: task.priority, kind: task.kind, dueAt: task.dueAt, updatedAt: task.updatedAt,
    state: deriveManagementWorkState({ taskStatus: task.status, executionStatus: task.projection?.displayState }), url: taskUrl(client, task.id),
  })) };
}
export async function managementTaskSnapshot(client: ManagementIdentity, taskId: string) {
  const task = await scopedTask(client, taskId);
  return { task: { taskId: task.id, title: task.title, status: task.status, priority: task.priority, url: taskUrl(client, task.id) }, revision: configRevision(task.configRevision) };
}

export async function readManagementTask(client: ManagementIdentity, input: ManagementRead) {
  const task = await scopedTask(client, input.taskId, input.workBlockId);
  const scope = await resolveExecutionScope(task.id, { workBlockId: input.workBlockId });
  const workBlockId = scope.workBlockId;
  const [savedCandidate, planRun, head, session, commands] = await Promise.all([
    db.taskPlan.findFirst({ where: { taskId: task.id, workBlockId }, orderBy: [{ revision: "desc" }, { createdAt: "desc" }, { id: "desc" }] }),
    db.taskPlanRun.findFirst({ where: { taskId: task.id, workBlockId, ...(scope.planId ? { planId: scope.planId } : {}) }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }] }),
    db.taskPlanGenerationHead.findUnique({ where: { taskId_workBlockScopeKey: { taskId: task.id, workBlockScopeKey: workBlockId ?? "" } }, select: { stateVersion: true, status: true, currentPlanId: true } }),
    db.executionSession.findFirst({ where: { taskId: task.id, workBlockId, ...(scope.planId ? { planId: scope.planId } : {}) }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }] }),
    db.managementCommand.findMany({ where: { workspaceId: client.workspaceId, taskId: task.id }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, phase: true, state: true, errorCode: true, createdAt: true, updatedAt: true } }),
  ]);
  const savedPlan = head?.currentPlanId ? await db.taskPlan.findFirst({ where: { planId: head.currentPlanId, taskId: task.id, workBlockId } }) : savedCandidate;
  const execution = planRun ? await readExistingExecution({ taskId: task.id, workBlockId, planId: planRun.planId, taskStatus: task.status }) : null;
  const approvals = planRun ? await db.taskPlanProviderApproval.findMany({ where: { taskId: task.id, workBlockId, planRunId: planRun.id, status: "pending" }, take: 20, orderBy: { requestedAt: "desc" }, select: { id: true, title: true, summary: true, riskLevel: true, choices: true, requestedAt: true } }) : [];
  const planOutput = record(record(record(planRun?.planRun).mutableGraph).planOutput);
  const resultFinalization = managementResultFinalization(planOutput);
  const state = deriveManagementWorkState({ taskStatus: task.status, executionStatus: execution?.status ?? task.projection?.displayState, planStatus: savedPlan?.status, hasPlan: Boolean(savedPlan), hasAcceptedPlan: savedPlan?.status === "Accepted" }, resultFinalization);
  const canAcceptResult = state.state === "result_ready" && resultFinalization.canAccept;
  const common = {
    task: { taskId: task.id, title: task.title, status: task.status, priority: task.priority, kind: task.kind, createdAt: task.createdAt, updatedAt: task.updatedAt, url: taskUrl(client, task.id) },
    revision: configRevision(task.configRevision), state, resultFinalization,
    savedPlan: savedPlan ? { planId: savedPlan.planId, revision: savedPlan.revision, status: savedPlan.status, expectedHeadStateVersion: head?.stateVersion ?? null } : null,
    execution: planRun ? { executionScope: planRun.executionScopeId, planId: planRun.planId, occurrenceId: planRun.occurrenceId, workBlockId, status: execution?.status ?? session?.status ?? "not_started", currentNodeId: execution?.currentNodeId ?? session?.currentNodeId ?? null, checkpoint: execution?.checkpoint ? safeCheckpoint(execution.checkpoint) : null } : null,
    commands,
    providerApprovals: approvals.map((approval) => ({ ...approval, title: text(approval.title, 200), summary: text(approval.summary, 1_000), executionScope: planRun?.executionScopeId })),
    editability: { canUpdate: client.scopes.includes("tasks:write"), sourceManaged: task.importedCalendarEvents.length > 0, sourceLockedFields: task.importedCalendarEvents.length ? ["title", "schedule", "recurrence"] : [] },
    availableActions: [
      { type: "generate_plan", permitted: client.scopes.includes("plans:write") },
      { type: "accept_plan", permitted: client.scopes.includes("plans:write"), planId: savedPlan?.planId ?? null, expectedHeadStateVersion: head?.stateVersion ?? null },
      { type: "execution", permitted: client.scopes.includes("executions:control"), expectedExecutionScope: planRun?.executionScopeId ?? null },
      { type: "accept_result", permitted: client.scopes.includes("results:accept") && canAcceptResult, runId: planRun ? `plan_execution_${planRun.id}` : null,
        disabledReason: !client.scopes.includes("results:accept") ? "Client lacks results:accept" : !canAcceptResult ? "Current result is not ready for acceptance" : null },
      { type: "retry_result", permitted: client.scopes.includes("executions:control") && resultFinalization.status === "Failed", expectedExecutionScope: planRun?.executionScopeId ?? null },
    ],
  };
  if (input.view === "summary") return { ...common, descriptionPreview: text(task.description, 500), descriptionTruncated: (task.description?.length ?? 0) > 500, dueAt: task.dueAt, schedule: task.projection ? { startsAt: task.projection.scheduledStartAt, endsAt: task.projection.scheduledEndAt } : null };
  if (input.view === "description") return { ...common, description: task.description, goalId: task.goalId, parentTaskId: task.parentTaskId };
  if (input.view === "config") {
    const config = record(task.executionConfig);
    const safeConfig = managementExecutionConfigSchema.partial().parse(Object.fromEntries(Object.entries(config).filter(([key]) => key !== "prompt" && key in managementExecutionConfigSchema.shape)));
    const [blocks, trigger] = await Promise.all([
      db.workBlock.findMany({ where: { taskId: task.id, status: { in: ["Scheduled", "Active"] } }, orderBy: { scheduledStartAt: "asc" }, take: 20, select: { id: true, status: true, scheduledStartAt: true, scheduledEndAt: true } }),
      db.taskTrigger.findUnique({ where: { taskId_kind: { taskId: task.id, kind: "schedule" } }, select: { config: true } }),
    ]);
    return { ...common, description: task.description, aiClientId: task.aiClientId, executionConfig: safeConfig, promptOmitted: typeof config.prompt === "string", autoPlanGeneration: task.autoPlanGeneration, autoExecute: task.autoExecute, timing: { plan: task.autoPlanGenerationTiming, execution: task.autoExecuteTiming }, dueAt: task.dueAt, recurrence: task.recurrenceRule ? { rule: task.recurrenceRule, timezone: text(record(trigger?.config).timezone, 80) ?? "UTC", anchorStartAt: task.recurrenceAnchorStartAt, anchorEndAt: task.recurrenceAnchorEndAt } : null, workBlocks: blocks };
  }
  const page = input.page ?? 1, pageSize = input.pageSize ?? 10, skip = (page - 1) * pageSize;
  if (input.view === "plan") {
    const plan = input.planSource === "execution" ? (planRun ? await db.taskPlan.findUnique({ where: { planId: planRun.planId } }) : null) : savedPlan;
    const compiled = record(plan?.compiledPlan);
    const nodes = Array.isArray(compiled.nodes) ? compiled.nodes : [];
    return { ...common, plan: plan ? { planId: plan.planId, revision: plan.revision, status: plan.status, summary: text(plan.summary, 2_000), ...pageInfo(nodes.length, page, pageSize), nodes: nodes.slice(skip, skip + pageSize).map((item) => { const node = record(item); return { id: text(node.id, 128), title: text(node.title, 200), type: text(node.type, 30), summary: text(node.description, 500), executor: text(node.executor, 30) }; }) } : null };
  }
  if (input.view === "activity") {
    const where: Prisma.EventWhereInput = { taskId: task.id, ...(input.workBlockId ? { workBlockId } : {}), OR: ["task.", "task_plan.", "plan_execution.", "execution.", "schedule.", "plan_generation."].map((prefix) => ({ eventType: { startsWith: prefix } })) };
    const [events, total] = await Promise.all([db.event.findMany({ where, orderBy: [{ ingestSequence: "desc" }, { id: "desc" }], skip, take: pageSize, select: { id: true, eventType: true, summary: true, ingestedAt: true, runId: true, workBlockId: true } }), db.event.count({ where })]);
    return { ...common, activity: { ...pageInfo(total, page, pageSize), items: events.map((event) => ({ ...event, summary: event.eventType })) } };
  }
  const accepted = await db.event.findFirst({ where: { taskId: task.id, ...(input.workBlockId ? { workBlockId } : {}), eventType: "task.result_accepted" }, orderBy: [{ ingestSequence: "desc" }, { id: "desc" }], select: { runId: true, payload: true, ingestedAt: true } });
  const acceptedRunId = text(record(accepted?.payload).accepted_run_id, 128) ?? accepted?.runId;
  const run = input.resultSource === "accepted" ? (acceptedRunId ? await db.run.findFirst({ where: { id: acceptedRunId, taskId: task.id, ...(input.workBlockId ? { workBlockId } : {}) } }) : null) : await db.run.findFirst({ where: { taskId: task.id, workBlockId, ...(planRun ? { id: `plan_execution_${planRun.id}` } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (!run) return { ...common, result: null };
  const followUps = await db.taskResultContinuation.findMany({ where: { taskId: task.id, acceptedRunId: run.id }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, intent: true, status: true, instruction: true, answer: true, createdTaskId: true, createdAt: true } });
  const resultPlanRun = run.runtimeRunRef?.startsWith("chrona-plan:") ? await db.taskPlanRun.findFirst({ where: { id: run.runtimeRunRef.slice("chrona-plan:".length), taskId: task.id, workBlockId: run.workBlockId, occurrenceId: run.occurrenceId }, select: { planRun: true } }) : null;
  const output = record(record(record(resultPlanRun?.planRun).mutableGraph).planOutput);
  const resultState = managementResultFinalization(output);
  const { artifacts, count } = await managementResultArtifacts({ workspaceId: client.workspaceId, taskId: task.id, run, output, page, pageSize });
  const elements = record(record(record(output.finalizedResult).spec).elements);
  const composedSummary = (resultState.canAccept ? Object.values(elements) : []).slice(0, 200).flatMap((element) => { const e = record(element), props = record(e.props); return ["ResultOverview", "ResultSummary", "ResultHero", "ResultInsight"].includes(String(e.type)) ? [text(props.text, 1_000), text(props.summary, 1_000)].filter(Boolean) : []; }).join("\n");
  // Semantic execution content remains readable while presentation is pending;
  // label its source explicitly rather than pretending it is finalized output.
  const summary = composedSummary || text(record(record(output.manifest).outcome).summary, 3_001) || "";
  return { ...common, result: { runId: run.id, status: run.status, finalization: resultState, summarySource: composedSummary ? "finalized_result" : summary ? "manifest" : null, followUps: followUps.map((item) => ({ ...item, instruction: text(item.instruction, 500), answer: text(item.answer, 4_000), answerTruncated: (item.answer?.length ?? 0) > 4_000 })), accepted: run.id === acceptedRunId, acceptedAt: run.id === acceptedRunId ? accepted?.ingestedAt : null, summary: text(summary, 3_000), summaryTruncated: summary.length > 3_000, ...pageInfo(count, page, pageSize), artifacts: artifacts.map((artifact) => ({ ref: artifact.id, artifactRef: aiArtifactRef(artifact.id), title: text(artifact.title, 200), type: artifact.type, url: taskUrl(client, task.id) })) } };
}
function safeCheckpoint(value: unknown) {
  const c = record(value), form = record(c.form);
  return { id: c.id, nodeId: c.nodeId, kind: c.kind, title: text(c.title, 200), message: text(c.message, 1_000), formRevision: form.revision, instructions: text(form.instructions, 2_000),
    availableActions: Array.isArray(c.availableActions) ? c.availableActions.slice(0, 20).map((item) => { const a = record(item); return { id: a.id, label: text(a.label, 200), requiresPayload: a.requiresPayload }; }) : [],
    inputFields: Array.isArray(form.inputFields) ? form.inputFields.slice(0, 32).map((field) => { const f = record(field); return { name: text(f.name, 128), label: text(f.label, 200), type: text(f.type, 30), required: f.required === true, options: Array.isArray(f.options) ? f.options.slice(0, 32).map((option) => text(option, 200)) : undefined }; }) : [] };
}
