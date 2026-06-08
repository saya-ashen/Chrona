import type { ChronaToolOperation, PlanBlueprint } from "@chrona/contracts";
import { db } from "@/lib/db";
import { resolveScopeWorkBlockId } from "@/modules/plan-execution/persistence/execution-scope";
import type { AgentToolOperationsDeps, ToolAuditContext } from "./types";
import { requireTaskId, requireWorkspaceId } from "./input-guards";
import { readAiExecutionView } from "./ai-execution-view";

export function toolCommandContext(operation: ChronaToolOperation, audit?: ToolAuditContext | null) {
  return {
    actor: {
      type: "agent" as const,
      actorId: operation.input.actorId ?? null,
      providerRunId: audit?.providerRunId ?? null,
      toolInvocationId: audit?.invocationId ?? null,
    },
    origin: {
      channel: "mcp_tool" as const,
      requestId: audit?.operationId ?? null,
      rawEventId: audit?.inputRawEventId ?? null,
    },
    nodeAttemptId: audit?.nodeAttemptId ?? null,
    providerRunId: audit?.providerRunId ?? null,
    toolInvocationId: audit?.invocationId ?? null,
    causationRawEventId: audit?.inputRawEventId ?? null,
  };
}

export async function executeValidatedTool(
  deps: AgentToolOperationsDeps,
  operation: ChronaToolOperation,
  payload: unknown,
  audit?: ToolAuditContext | null,
) {
  const { input, toolName } = operation;
  switch (toolName) {
    case "chrona.task.read":
      return deps.tasks.getPage({ taskId: requireTaskId(input) });
    case "chrona.task.create":
      return createTaskForTool(deps, input, payload);
    case "chrona.task.update":
      return deps.tasks.update({
        ...(payload as Omit<Parameters<typeof deps.tasks.update>[0], "taskId">),
        taskId: requireTaskId(input),
        workspaceId: requireWorkspaceId(input),
      });
    case "chrona.plan.read":
      return readAiExecutionView(await deps.plan.getState({ taskId: requireTaskId(input) }));
    case "chrona.plan.generate":
      return generatePlanForTool(deps, input, payload);
    case "chrona.plan.mutate":
      return deps.plan.mutate({
        taskId: requireTaskId(input),
        mutation: payload as Parameters<typeof deps.plan.mutate>[0]["mutation"],
      });
    case "chrona.schedule.read":
      return deps.tasks.getPage({ taskId: requireTaskId(input) });
    case "chrona.schedule.propose": {
      const body = payload as {
        source?: string;
        proposedBy?: string;
        summary?: string;
        dueAt?: string | null;
        scheduledStartAt?: string | null;
        scheduledEndAt?: string | null;
      };
      return deps.schedule.propose({
        taskId: requireTaskId(input),
        source: body.source ?? "ai",
        proposedBy: body.proposedBy ?? input.actorId ?? "agent",
        summary: body.summary ?? "Agent schedule proposal",
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        scheduledStartAt: body.scheduledStartAt ? new Date(body.scheduledStartAt) : null,
        scheduledEndAt: body.scheduledEndAt ? new Date(body.scheduledEndAt) : null,
      } as Parameters<typeof deps.schedule.propose>[0]);
    }
    case "chrona.schedule.set": {
      const body = payload as {
        dueAt?: string | null;
        scheduledStartAt: string;
        scheduledEndAt: string;
        scheduleSource?: "human" | "ai" | "system";
      };
      return deps.schedule.apply({
        taskId: requireTaskId(input),
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        scheduledStartAt: new Date(body.scheduledStartAt),
        scheduledEndAt: new Date(body.scheduledEndAt),
        scheduleSource: body.scheduleSource ?? "ai",
      });
    }
    case "chrona.schedule.clear":
      return deps.schedule.clear({ taskId: requireTaskId(input) });
    case "chrona.execution.read":
      return readAiExecutionView(await deps.tasks.getPage({ taskId: requireTaskId(input) }));
    case "chrona.execution.dispatch":
      return deps.execution.dispatch({
        taskId: requireTaskId(input),
        action: payload as Parameters<typeof deps.execution.dispatch>[0]["action"],
      });
    case "chrona.node.read":
      return readAiExecutionView(await deps.tasks.getPage({ taskId: requireTaskId(input) }));
    case "chrona.node.output": {
      const body = payload as {
        outputs: unknown;
        mode?: "append" | "replace";
        summary?: string;
      };
      return deps.execution.submitNodeResult({
        taskId: requireTaskId(input),
        commandContext: toolCommandContext(operation, audit),
        action: {
          action: "submit_node_output" as const,
          sessionId: input.sessionId,
          outputs: body.outputs,
          mode: body.mode,
          summary: body.summary,
        },
      });
    }
    case "chrona.node.complete":
    case "chrona.node.condition_select":
    case "chrona.node.wait_complete": {
      const body = payload as {
        summary?: string;
        nodeId?: string;
        branchRef?: string;
        decision?: "approved" | "rejected" | "needs_input" | "completed";
        feedback?: string;
        prompt?: string;
        input?: unknown;
      };
      const terminalKind = toolName === "chrona.node.condition_select"
        ? "condition"
        : toolName === "chrona.node.wait_complete"
            ? "wait"
            : "task";
      return deps.execution.submitNodeResult({
        taskId: requireTaskId(input),
        commandContext: toolCommandContext(operation, audit),
        action: {
          action: "complete_manual_node" as const,
          sessionId: input.sessionId,
          nodeId: body.nodeId,
          summary: body.summary,
          output: body.input,
          terminalKind,
          branchRef: body.branchRef,
          decision: body.decision,
          feedback: body.feedback,
          prompt: body.prompt,
        },
      });
    }
    case "chrona.node.block": {
      const body = payload as {
        reason: string;
        actionForm: NonNullable<Extract<Parameters<typeof deps.execution.submitNodeResult>[0]["action"], { action: "block_current_node" }>["actionForm"]>;
      };
      return deps.execution.submitNodeResult({
        taskId: requireTaskId(input),
        commandContext: toolCommandContext(operation, audit),
        action: {
          action: "block_current_node" as const,
          sessionId: input.sessionId,
          reason: body.reason,
          actionForm: body.actionForm,
        },
      });
    }
    case "chrona.node.fail": {
      const body = payload as { error: string };
      return deps.execution.submitNodeResult({
        taskId: requireTaskId(input),
        commandContext: toolCommandContext(operation, audit),
        action: {
          action: "fail_current_node" as const,
          sessionId: input.sessionId,
          error: body.error,
        },
      });
    }
  }
}

async function createTaskForTool(
  deps: AgentToolOperationsDeps,
  input: ChronaToolOperation["input"],
  payload: unknown,
) {
  const result = await deps.tasks.create({
    ...(payload as Parameters<typeof deps.tasks.create>[0]),
    workspaceId: requireWorkspaceId(input),
  });
  const sessionId = input.sessionId?.trim();
  if (sessionId && "taskId" in result && typeof result.taskId === "string") {
    const existingSession = await db.taskSession.findUnique({ where: { sessionKey: sessionId } });
    if (!existingSession) {
      const task = await db.task.findUnique({
        where: { id: result.taskId },
        select: { title: true, executionRuntime: true },
      });
      await db.taskSession.create({
        data: {
          taskId: result.taskId,
          runtimeName: task?.executionRuntime ?? "unknown",
          sessionKey: sessionId,
          label: `${task?.title ?? "Task"} · Creation session`,
          createdByFramework: true,
        },
      });
    }
  }
  return result;
}

async function generatePlanForTool(
  deps: AgentToolOperationsDeps,
  input: ChronaToolOperation["input"],
  payload: unknown,
) {
  const taskId = requireTaskId(input);
  const workspaceId = requireWorkspaceId(input);
  // Pin the generated plan to the same work block reads/execution resolve to, so
  // an agent regenerating mid-session does not create a null-scoped draft that
  // shadows the work-block-scoped accepted plan.
  const workBlockId = await resolveScopeWorkBlockId(taskId, { sessionId: input.sessionId });
  const savedPlan = await deps.plan.materialize({
    taskId,
    workspaceId,
    workBlockId,
    blueprint: payload as PlanBlueprint,
    generatedBy: input.actorId ?? "hermes",
  });
  return {
    taskId,
    savedPlan,
  };
}
