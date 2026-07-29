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
import type { PlanExecutionSSEEvent } from "@chrona/contracts";
import type { EffectivePlanGraph } from "@chrona/contracts/ai";
import type {
  GraphExecutionEvent,
  PlanExecutionRuntimeEvent,
} from "@chrona/engine";

import { error, toHttpError } from "../../lib/http";
import { startSseHeartbeat } from "../../lib/sse-heartbeat";
import { checkpointActionToExecutionAction, summarizeRuntimeEvent } from "@features/execution-monitoring/server";

type SseStream = Parameters<typeof streamSSE>[1] extends (stream: infer T) => Promise<unknown> ? T : never;
const HERMES_DEFAULT_APPROVAL_TIMEOUT_MS = 60_000;

function toJsonInput(value: unknown) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

async function reconcileTimedOutProviderApprovals(taskId: string) {
  const pendingApprovals = await db.taskPlanProviderApproval.findMany({
    where: {
      taskId,
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
    const message = result && "summary" in result
      ? result.summary
      : result && "error" in result
        ? result.error
        : result && "reason" in result
          ? result.reason
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

export function createExecutionRoutes(engine: ChronaEngine) {
  return new Hono().get(
    "/tasks/:taskId/execution/current",
    zValidator("param", executionActionParamSchema),
    async (c) => {
      try {
        const { taskId } = c.req.valid("param");
        const workBlockId = c.req.query("workBlockId") || null;
        const result = await engine.tasks.execution.current({ taskId, workBlockId });
        return c.json(result);
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return error(c, cause instanceof Error ? cause.message : "Failed to load current execution state", 500);
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
                void writeEvent(summarizeRuntimeEvent(action.action, event));
              },
              onStateChange(effectivePlan: EffectivePlanGraph) {
                void writeEvent({
                  type: "state",
                  effectivePlan,
                });
              },
            });

            await writeEvent({ type: "result", result });
            await writeEvent({ type: "done" });
          } catch (cause) {
            const httpError = toHttpError(cause);
            await writeEvent({
              type: "error",
              code: "INTERNAL_ERROR",
              message: httpError?.message ?? (cause instanceof Error ? cause.message : "Failed to dispatch execution action"),
            });
            await writeEvent({ type: "done" });
          } finally {
            await writeQueue;
            stopHeartbeat();
          }
        });
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return error(c, cause instanceof Error ? cause.message : "Failed to dispatch execution action", 500);
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
                void writeEvent(summarizeRuntimeEvent(executionAction, event));
              },
              onStateChange(effectivePlan: EffectivePlanGraph) {
                void writeEvent({
                  type: "state",
                  effectivePlan,
                });
              },
            });

            await writeEvent({ type: "result", result: result.execution });
            await writeEvent({ type: "done" });
          } catch (cause) {
            const httpError = toHttpError(cause);
            await writeEvent({
              type: "error",
              code: "INTERNAL_ERROR",
              message: httpError?.message ?? (cause instanceof Error ? cause.message : "Failed to submit checkpoint action"),
            });
            await writeEvent({ type: "done" });
          } finally {
            await writeQueue;
            stopHeartbeat();
          }
        });
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return error(c, cause instanceof Error ? cause.message : "Failed to submit checkpoint action", 500);
      }
    },
  ).get(
    "/tasks/:taskId/provider-approvals",
    zValidator("param", executionActionParamSchema),
    zValidator("query", providerApprovalListQuerySchema),
    async (c) => {
      try {
        const { taskId } = c.req.valid("param");
        const { status = "pending" } = c.req.valid("query");
        if (status === "pending" || status === "all") {
          await reconcileTimedOutProviderApprovals(taskId);
        }
        const approvals = await db.taskPlanProviderApproval.findMany({
          where: {
            taskId,
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
        return error(c, cause instanceof Error ? cause.message : "Failed to load provider approvals", 500);
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
        const result = await engine.tasks.execution.resolveProviderApproval({
          taskId,
          approvalId,
          choice: body.choice,
          resolveAll: body.resolveAll,
          note: body.note,
        });
        return c.json({
          approval: toApprovalReadModel(result.approval),
          provider: result.provider,
          runId: result.runId,
          choice: result.choice,
          resolved: result.resolved,
          status: result.status,
        });
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return error(c, cause instanceof Error ? cause.message : "Failed to resolve provider approval", 500);
      }
    },
  );
}

type ProviderApprovalRecord = Awaited<ReturnType<typeof db.taskPlanProviderApproval.findFirst>> & {};

function toApprovalReadModel(approval: NonNullable<ProviderApprovalRecord>) {
  return {
    id: approval.id,
    taskId: approval.taskId,
    workBlockId: approval.workBlockId,
    planId: approval.planId,
    planRunId: approval.planRunId,
    nodeId: approval.nodeId,
    nodeTitle: approval.nodeTitle,
    provider: approval.provider,
    runtimeName: approval.runtimeName,
    nativeRunId: approval.nativeRunId,
    kind: approval.kind,
    providerKind: approval.providerKind,
    title: approval.title,
    summary: approval.summary,
    description: approval.description,
    riskLevel: approval.riskLevel,
    subject: approval.subject,
    choices: approval.choices,
    scopePolicy: approval.scopePolicy,
    status: approval.status,
    requestedAt: approval.requestedAt.toISOString(),
    resolvedAt: approval.resolvedAt?.toISOString() ?? null,
    choice: approval.choice,
    resolveAll: approval.resolveAll,
  };
}
