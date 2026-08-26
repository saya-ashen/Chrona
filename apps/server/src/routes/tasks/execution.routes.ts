import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import { db } from "@chrona/db";
import {
  checkpointActionBodySchema,
  checkpointActionParamSchema,
  executionActionBodySchema,
  executionActionParamSchema,
  providerApprovalListQuerySchema,
  providerApprovalResolveBodySchema,
  providerApprovalResolveParamSchema,
} from "@chrona/contracts/api";
import type { EffectivePlanGraph, PlanExecutionResult, PlanExecutionSSEEvent, PublicPlanExecutionResult } from "@chrona/contracts";
import { projectPublicEffectivePlanGraph, publicProviderDescriptor } from "@chrona/contracts";
import type {
  GraphExecutionEvent,
  PlanExecutionRuntimeEvent,
} from "@chrona/engine";

import { error, HttpError, internalServerError, toHttpError } from "../../lib/http";

import { startSseHeartbeat } from "../../lib/sse-heartbeat";
import { checkpointActionToExecutionAction, summarizeRuntimeEvent } from "@features/execution-monitoring/server";
function executionStreamError(cause: unknown, fallback: string): Extract<PlanExecutionSSEEvent, { type: "error" }> {
  const httpError = toHttpError(cause);
  return {
    type: "error",
    code: httpError?.status === 409
      ? "CONFLICT"
      : httpError?.status === 400
        ? "VALIDATION_ERROR"
        : "INTERNAL_ERROR",
    message: httpError?.status === 409 || httpError?.status === 400 ? httpError.message : fallback,
  };
}

type SseStream = Parameters<typeof streamSSE>[1] extends (stream: infer T) => Promise<unknown> ? T : never;
const HERMES_DEFAULT_APPROVAL_TIMEOUT_MS = 60_000;

function toJsonInput(value: unknown) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

async function reconcileTimedOutProviderApprovals(input: {
  taskId: string;
  workBlockId: string | null;
  planRunId: string;
}) {
  const pendingApprovals = await db.taskPlanProviderApproval.findMany({
    where: {
      taskId: input.taskId,
      workBlockId: input.workBlockId,
      planRunId: input.planRunId,
      status: "pending",
    },
    select: {
      id: true,
      providerRunId: true,
      requestedAt: true,
    },
  });

  for (const approval of pendingApprovals) {
    if (!approval.providerRunId) continue;
    const timeoutAt = new Date(approval.requestedAt.getTime() + HERMES_DEFAULT_APPROVAL_TIMEOUT_MS);
    const laterEvent = await db.event.findFirst({
      where: {
        providerRunId: approval.providerRunId,
        occurredAt: { gte: timeoutAt },
        NOT: { eventType: "approval_required" },
      },
      orderBy: { occurredAt: "asc" },
      select: {
        eventType: true,
        occurredAt: true,
      },
    });
    if (!laterEvent) continue;

    await db.taskPlanProviderApproval.updateMany({
      where: {
        id: approval.id,
        taskId: input.taskId,
        workBlockId: input.workBlockId,
        planRunId: input.planRunId,
        status: "pending",
      },
      data: {
        status: "superseded",
        resolvedAt: laterEvent.occurredAt,
        resolvedBy: "provider",
        resolutionRaw: toJsonInput({
          resolution_source: "provider_reconciliation",
          reason: "provider_emitted_event_after_default_approval_timeout",
          inferred_result: "default_denied",
          timeoutMs: HERMES_DEFAULT_APPROVAL_TIMEOUT_MS,
          observed_event_type: laterEvent.eventType,
        }),
      },
    });
  }
}


function summarizeGraphEvent(event: GraphExecutionEvent): Extract<PlanExecutionSSEEvent, { type: "graph_event" }> {
  if ("node" in event) {
    const result = "result" in event ? event.result : null;
    const message = result && "summary" in result && typeof result.summary === "string"
      ? result.summary.slice(0, 500)
      : result && "error" in result
        ? "Node execution failed."
        : result && "reason" in result
          ? "Node execution requires attention."
          : undefined;
    return {
      type: "graph_event",
      event: event.type,
      nodeId: event.node.id,
      nodeTitle: event.node.title,
      status: result?.status,
      message,
    };
  }

  return { type: "graph_event", event: event.type };
}

function writeExecutionEvent(stream: SseStream, event: PlanExecutionSSEEvent) {
  return stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
}

function publicExecutionMessage(status: PlanExecutionResult["status"]): string {
  switch (status) {
    case "started": return "Plan execution started.";
    case "running": return "Plan execution is running.";
    case "waiting_for_user": return "Plan execution is waiting for user input.";
    case "waiting_for_approval": return "Plan execution is waiting for approval.";
    case "blocked": return "Plan execution requires attention.";
    case "failed": return "Plan execution failed.";
    case "completed": return "Plan execution completed.";
    case "cancelled": return "Plan execution cancelled.";
    case "no_plan": return "No accepted plan is available.";
  }
}

async function toPublicExecutionResult(result: PlanExecutionResult): Promise<PublicPlanExecutionResult> {
  const {
    mainSessionId: _mainSessionId,
    executionSessionId: _executionSessionId,
    planRunId,
    checkpoint,
    ...publicResult
  } = result;
  const safePublicResult = { ...publicResult, message: publicExecutionMessage(publicResult.status) };
  const planRun = planRunId
    ? await db.taskPlanRun.findUnique({ where: { id: planRunId }, select: { executionScopeId: true } })
    : null;
  const executionScope = planRun?.executionScopeId ?? null;
  if (!checkpoint) return { ...safePublicResult, executionScope, checkpoint: null };
  const {
    sessionId: _sessionId,
    planRunId: _checkpointPlanRunId,
    ...publicCheckpoint
  } = checkpoint;
  return { ...safePublicResult, executionScope, checkpoint: publicCheckpoint };
}

async function resolveExecutionScope(input: {
  taskId: string;
  workBlockId: string | null;
  executionScope: string;
}): Promise<string> {
  const planRun = await db.taskPlanRun.findUnique({
    where: { executionScopeId: input.executionScope },
    select: { id: true, taskId: true, workBlockId: true },
  });
  if (!planRun || planRun.taskId !== input.taskId || planRun.workBlockId !== (input.workBlockId ?? null)) {
    throw new HttpError(404, "Execution scope not found");
  }
  return planRun.id;
}

export function createExecutionRoutes(engine: ChronaEngine) {
  return new Hono().get(
    "/tasks/:taskId/execution/current",
    zValidator("param", executionActionParamSchema),
    async (c) => {
      try {
        const { taskId } = c.req.valid("param");
        const workBlockId = c.req.query("workBlockId") || null;
        const result = await engine.tasks.execution.current({ taskId, workBlockId });
        return c.json(await toPublicExecutionResult(result));
      } catch (cause) {
        const httpError = toHttpError(cause);
        return error(c, "Failed to load current execution state", httpError?.status ?? 500);
      }
    },
  ).post(
    "/tasks/:taskId/execution/actions",
    zValidator("param", executionActionParamSchema),
    zValidator("json", executionActionBodySchema),
    async (c) => {
      try {
        const { taskId } = c.req.valid("param");
        const action = c.req.valid("json");

        return streamSSE(c, async (stream) => {
          const stopHeartbeat = startSseHeartbeat(stream);
          let writeQueue = Promise.resolve();
          const writeEvent = (event: PlanExecutionSSEEvent) => {
            writeQueue = writeQueue.then(() => writeExecutionEvent(stream, event)).then(() => undefined);
            return writeQueue;
          };

          stream.onAbort(() => {
            stopHeartbeat();
          });

          try {
            await writeEvent({
              type: "status",
              action: action.action,
              message: "Plan execution started.",
            });

            const result = await engine.tasks.execution.dispatch({
              taskId,
              action: action as Parameters<typeof engine.tasks.execution.dispatch>[0]["action"],
              onGraphEvent(event: GraphExecutionEvent) {
                void writeEvent(summarizeGraphEvent(event));
              },
              onRuntimeEvent(event: PlanExecutionRuntimeEvent) {
                const summary = summarizeRuntimeEvent(action.action, event);
                if (summary) void writeEvent(summary);
              },
              onStateChange(effectivePlan: EffectivePlanGraph) {
                void writeEvent({
                  type: "state",
                  effectivePlan: projectPublicEffectivePlanGraph(effectivePlan),
                });
              },
            });

            await writeEvent({ type: "result", result: await toPublicExecutionResult(result) });
            await writeEvent({ type: "done" });
          } catch (cause) {
            await writeEvent(executionStreamError(cause, "Failed to dispatch execution action"));
            await writeEvent({ type: "done" });
          } finally {
            await writeQueue;
            stopHeartbeat();
          }
        });
      } catch (cause) {
        const httpError = toHttpError(cause);
        return error(c, "Failed to dispatch execution action", httpError?.status ?? 500);
      }
    },
  ).post(
    "/tasks/:taskId/execution/checkpoint/:checkpointId/actions",
    zValidator("param", checkpointActionParamSchema),
    zValidator("json", checkpointActionBodySchema),
    async (c) => {
      try {
        const { taskId, checkpointId } = c.req.valid("param");
        const action = c.req.valid("json");

        return streamSSE(c, async (stream) => {
          const stopHeartbeat = startSseHeartbeat(stream);
          let writeQueue = Promise.resolve();
          const writeEvent = (event: PlanExecutionSSEEvent) => {
            writeQueue = writeQueue.then(() => writeExecutionEvent(stream, event)).then(() => undefined);
            return writeQueue;
          };
          const executionAction = checkpointActionToExecutionAction(action.action);

          stream.onAbort(() => {
            stopHeartbeat();
          });

          try {
            await writeEvent({
              type: "status",
              action: executionAction,
              message: "Checkpoint action submitted.",
            });

            const result = await engine.tasks.execution.submitCheckpointAction({
              taskId,
              action: { checkpointId, ...action },
              onGraphEvent(event: GraphExecutionEvent) {
                void writeEvent(summarizeGraphEvent(event));
              },
              onRuntimeEvent(event: PlanExecutionRuntimeEvent) {
                const summary = summarizeRuntimeEvent(executionAction, event);
                if (summary) void writeEvent(summary);
              },
              onStateChange(effectivePlan: EffectivePlanGraph) {
                void writeEvent({
                  type: "state",
                  effectivePlan: projectPublicEffectivePlanGraph(effectivePlan),
                });
              },
            });

            await writeEvent({ type: "result", result: await toPublicExecutionResult(result.execution) });
            await writeEvent({ type: "done" });
          } catch (cause) {
            await writeEvent(executionStreamError(cause, "Failed to submit checkpoint action"));
            await writeEvent({ type: "done" });
          } finally {
            await writeQueue;
            stopHeartbeat();
          }
        });
      } catch (cause) {
        const httpError = toHttpError(cause);
        return error(c, "Failed to submit checkpoint action", httpError?.status ?? 500);
      }
    },
  ).get(
    "/tasks/:taskId/provider-approvals",
    zValidator("param", executionActionParamSchema),
    zValidator("query", providerApprovalListQuerySchema),
    async (c) => {
      try {
        const { taskId } = c.req.valid("param");
        const { workBlockId, executionScope, status = "pending" } = c.req.valid("query");
        const normalizedWorkBlockId = workBlockId ?? null;
        const planRunId = await resolveExecutionScope({ taskId, workBlockId: normalizedWorkBlockId, executionScope });
        if (status === "pending" || status === "all") {
          await reconcileTimedOutProviderApprovals({ taskId, workBlockId: normalizedWorkBlockId, planRunId });
        }
        const approvals = await db.taskPlanProviderApproval.findMany({
          where: {
            taskId,
            workBlockId: normalizedWorkBlockId,
            planRunId,
            ...(status === "all" ? {} : { status }),
          },
          orderBy: { requestedAt: "desc" },
        });
        return c.json({ approvals: approvals.map(toApprovalReadModel) });
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return internalServerError(c, "GET /api/tasks/:taskId/provider-approvals", cause, "Failed to load provider approvals");
      }
    },
  ).post(
    "/tasks/:taskId/provider-approvals/:approvalId/resolve",
    zValidator("param", providerApprovalResolveParamSchema),
    zValidator("json", providerApprovalResolveBodySchema),
    async (c) => {
      try {
        const { taskId, approvalId } = c.req.valid("param");
        const body = c.req.valid("json");
        const planRunId = await resolveExecutionScope({
          taskId,
          workBlockId: body.workBlockId ?? null,
          executionScope: body.executionScope,
        });
        const result = await engine.tasks.execution.resolveProviderApproval({
          taskId,
          approvalId,
          workBlockId: body.workBlockId ?? null,

          planRunId,
          choice: body.choice,
          resolveAll: body.resolveAll,
          note: body.note,
          idempotencyKey: body.idempotencyKey,
        });
        return c.json({
          approval: toApprovalReadModel(result.approval),
          choice: result.choice,
          resolved: result.resolved,
          status: result.status,
        });
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return internalServerError(c, "POST /api/tasks/:taskId/provider-approvals/:approvalId/resolve", cause, "Failed to resolve provider approval");
      }
    },
  );
}

type ProviderApprovalRecord = Awaited<ReturnType<typeof db.taskPlanProviderApproval.findFirst>> & {};

function toApprovalReadModel(approval: NonNullable<ProviderApprovalRecord>) {
  return {
    id: approval.id,
    nodeTitle: approval.nodeTitle,
    provider: publicProviderDescriptor(approval.provider),
    title: approval.title,
    summary: approval.summary,
    description: approval.description,
    riskLevel: approval.riskLevel,
    choices: approval.choices,
    status: approval.status,
    requestedAt: approval.requestedAt.toISOString(),
    resolvedAt: approval.resolvedAt?.toISOString() ?? null,
    choice: approval.choice,
    resolveAll: approval.resolveAll,
  };
}
