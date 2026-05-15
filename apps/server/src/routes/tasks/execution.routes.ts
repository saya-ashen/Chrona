import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import {
  executionActionBodySchema,
  executionActionParamSchema,
} from "@chrona/contracts/api";
import type { PlanExecutionSSEEvent } from "@chrona/contracts";
import type { EffectivePlanGraph, ExecutionActionType } from "@chrona/contracts/ai";
import type {
  GraphExecutionEvent,
  PlanExecutionRuntimeEvent,
} from "@chrona/engine/modules/plan-execution";

import { error, toHttpError } from "../../lib/http";

type SseStream = Parameters<typeof streamSSE>[1] extends (stream: infer T) => Promise<unknown> ? T : never;

function startSseHeartbeat(stream: SseStream) {
  const timer = setInterval(() => {
    void stream.writeSSE({ event: "heartbeat", data: "{}" }).catch(() => undefined);
  }, 5_000);
  return () => clearInterval(timer);
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

function toolLabel(toolName?: string): string {
  switch (toolName) {
    case "chrona_execution_dispatch":
      return "正在更新执行状态";
    case "chrona_plan_read":
      return "正在读取计划";
    case "chrona_plan_mutate":
      return "正在更新计划";
    case "chrona_task_read":
      return "正在读取任务";
    default:
      return toolName ?? "运行工具";
  }
}

function summarizeRuntimeEvent(
  action: ExecutionActionType,
  event: PlanExecutionRuntimeEvent,
): Extract<PlanExecutionSSEEvent, { type: "runtime_event" }> {
  const providerEvent = event.event;
  const provider = providerEvent.provider ?? "provider";
  const base = {
    type: "runtime_event" as const,
    action,
    nodeId: event.nodeId,
    nodeTitle: event.nodeTitle,
    runtimeName: event.runtimeName,
    provider,
    runId: providerEvent.runId,
    nativeRunId: providerEvent.nativeRunId,
    sequence: providerEvent.sequence,
    timestamp: providerEvent.timestamp,
    rawEventType: providerEvent.rawEventType,
  };

  switch (providerEvent.type) {
    case "text_delta":
      return { ...base, event: { type: "assistant_text_delta", text: providerEvent.text } };
    case "reasoning_delta":
      return { ...base, event: { type: "reasoning_delta", text: providerEvent.text } };
    case "tool_call":
      return {
        ...base,
        event: {
          type: "tool_started",
          toolName: providerEvent.tool,
          label: toolLabel(providerEvent.tool),
          input: providerEvent.input,
        },
      };
    case "tool_started":
      return {
        ...base,
        event: {
          type: "tool_started",
          toolName: providerEvent.toolName,
          label: toolLabel(providerEvent.toolName),
          preview: providerEvent.preview,
          input: providerEvent.input,
        },
      };
    case "tool_result":
      return {
        ...base,
        event: {
          type: "tool_completed",
          toolName: providerEvent.tool,
          label: toolLabel(providerEvent.tool),
        },
      };
    case "tool_completed":
      return {
        ...base,
        event: {
          type: "tool_completed",
          toolName: providerEvent.toolName,
          label: toolLabel(providerEvent.toolName),
          durationMs: providerEvent.durationMs,
          error: providerEvent.error
            ? {
                message: providerEvent.error.message,
                code: providerEvent.error.code,
              }
            : undefined,
        },
      };
    case "approval_required":
      return { ...base, event: { type: "approval_required", approval: providerEvent.approval } };
    case "run_started":
      return { ...base, event: { type: "run_status", status: "started", message: "Provider run started." } };
    case "run_completed":
      return { ...base, event: { type: "run_status", status: "completed", message: "Provider run finished. Chrona state sync is authoritative." } };
    case "run_failed":
      return { ...base, event: { type: "run_status", status: "failed", message: providerEvent.error } };
    case "run_cancelled":
      return { ...base, event: { type: "run_status", status: "cancelled", message: "Provider run cancelled." } };
    case "raw_event":
      return { ...base, event: { type: "raw_event", rawEventType: providerEvent.rawEventType } };
  }
}

function writeExecutionEvent(stream: SseStream, event: PlanExecutionSSEEvent) {
  return stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
}

export function createExecutionRoutes(engine: ChronaEngine) {
  return new Hono().post(
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
              action,
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
  );
}
