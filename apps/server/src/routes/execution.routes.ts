import { Hono } from "hono";

import { db } from "@chrona/db";
import { retryRun } from "@chrona/runtime/modules/commands/retry-run";
import { provideInput } from "@chrona/runtime/modules/commands/provide-input";
import { sendOperatorMessage } from "@chrona/runtime/modules/commands/send-operator-message";
import { resumeRun } from "@chrona/runtime/modules/commands/resume-run";
import { markTaskDone } from "@chrona/runtime/modules/commands/mark-task-done";
import { reopenTask } from "@chrona/runtime/modules/commands/reopen-task";
import { acceptTaskResult } from "@chrona/runtime/modules/commands/accept-task-result";
import { createFollowUpTask } from "@chrona/runtime/modules/commands/create-follow-up-task";
import { applySchedule } from "@chrona/runtime/modules/commands/apply-schedule";
import { clearSchedule } from "@chrona/runtime/modules/commands/clear-schedule";
import { proposeSchedule } from "@chrona/runtime/modules/commands/propose-schedule";
import { decideScheduleProposal } from "@chrona/runtime/modules/commands/decide-schedule-proposal";
import { resolveApproval } from "@chrona/runtime/modules/commands/resolve-approval";
import { invalidateMemory } from "@chrona/runtime/modules/commands/invalidate-memory";
import { getAcceptedTaskPlanGraph } from "@chrona/runtime/modules/tasks/task-plan-graph-store";
import {
  startPlanExecution,
  continuePlanExecution,
  advancePlanExecution,
  settlePlanNodeFromRun,
} from "@chrona/runtime/modules/plan-execution";

import {
  getOpenClawAdapter,
  ensureTaskInWorkspace,
  ensureProposalInWorkspace,
  toDateOrNull,
  ensureValidDateFields,
} from "./helpers";
import {
  error,
  internalServerError,
  json,
} from "../lib/http";

export function createExecutionRoutes() {
  const api = new Hono();

  api.post("/tasks/:taskId/run", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json().catch(() => ({}));

      const task = await db.task.findUnique({
        where: { id: taskId },
        select: { id: true, workspaceId: true, title: true },
      });
      if (!task) return error(c, "Task not found", 404);

      const acceptedPlan = await getAcceptedTaskPlanGraph(taskId);
      if (!acceptedPlan) {
        return error(c, "No accepted plan. Create or accept a plan before execution.", 400);
      }

      const result = await startPlanExecution({
        taskId,
        trigger: "manual",
        prompt: body.prompt,
      });

      return json(
        c,
        { workspaceId: task.workspaceId, ...result },
        201,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to start run";
      if (message.includes("not found") || message.includes("No 'Task' record")) {
        return error(c, "Task not found", 404);
      }
      return error(c, message, 500);
    }
  });

  api.post("/tasks/:taskId/execution/advance", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json().catch(() => ({}));

      const task = await db.task.findUnique({
        where: { id: taskId },
        select: { id: true, workspaceId: true, title: true },
      });
      if (!task) return error(c, "Task not found", 404);

      if (typeof body.runId === "string" && body.runId.trim()) {
        const result = await settlePlanNodeFromRun({
          taskId,
          runId: body.runId,
          reason: typeof body.reason === "string" ? body.reason : "child_run_completed",
        });
        return json(c, { workspaceId: task.workspaceId, ...result });
      }

      const result = await advancePlanExecution({
        taskId,
        trigger: "manual",
      });
      return json(c, { workspaceId: task.workspaceId, ...result });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to advance execution";
      return error(c, message, message.includes("not found") ? 404 : 500);
    }
  });

  api.post("/tasks/:taskId/execution/settle-run", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();

      if (!body.runId || typeof body.runId !== "string" || !body.runId.trim()) {
        return error(c, "runId is required", 400);
      }

      const task = await db.task.findUnique({
        where: { id: taskId },
        select: { id: true, workspaceId: true, title: true },
      });
      if (!task) return error(c, "Task not found", 404);

      const result = await settlePlanNodeFromRun({
        taskId,
        runId: body.runId,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      });
      return json(c, { workspaceId: task.workspaceId, ...result });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to settle run";
      return error(c, message, message.includes("not found") ? 404 : 500);
    }
  });

  api.post("/tasks/:taskId/retry", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json().catch(() => ({}));

      const task = await db.task.findUnique({
        where: { id: taskId },
        select: { id: true, workspaceId: true, title: true },
      });
      if (!task) return error(c, "Task not found", 404);

      const acceptedPlan = await getAcceptedTaskPlanGraph(taskId);
      if (acceptedPlan) {
        const result = await startPlanExecution({
          taskId,
          trigger: "manual",
          prompt: body.prompt,
        });
        return json(c, { workspaceId: task.workspaceId, ...result });
      }

      const adapter = await getOpenClawAdapter();
      return json(c, await retryRun({ taskId, prompt: body.prompt, adapter }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to retry run";
      return error(c, message, message.includes("not found") ? 404 : 500);
    }
  });

  api.post("/tasks/:taskId/input", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      if (!body.inputText || (typeof body.inputText === "string" && !body.inputText.trim())) {
        return error(c, "inputText is required", 400);
      }

      const task = await db.task.findUnique({
        where: { id: taskId },
        select: { id: true, workspaceId: true, status: true },
      });
      if (!task) return error(c, "Task not found", 404);

      const acceptedPlan = await getAcceptedTaskPlanGraph(taskId);
      if (acceptedPlan && task.status === "WaitingForInput") {
        const result = await continuePlanExecution({
          taskId,
          reason: "user_provided_input",
          userInput: body.inputText,
        });
        return json(c, { workspaceId: task.workspaceId, ...result });
      }

      let runId = body.runId as string | undefined;
      if (!runId) {
        const latestRun = await db.run.findFirst({
          where: { taskId, status: "WaitingForInput" },
          orderBy: { startedAt: "desc" },
          select: { id: true },
        });
        if (!latestRun) {
          return error(c, "No run waiting for input found for this task.", 400);
        }
        runId = latestRun.id;
      }
      const adapter = await getOpenClawAdapter();
      return json(c, await provideInput({ runId, inputText: body.inputText, adapter }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to provide input";
      return error(c, message, message.includes("not found") || message.includes("no longer exists") ? 404 : 500);
    }
  });

  api.post("/tasks/:taskId/message", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      if (!body.message || (typeof body.message === "string" && !body.message.trim())) {
        return error(c, "message is required", 400);
      }

      const task = await db.task.findUnique({
        where: { id: taskId },
        select: { id: true, workspaceId: true, status: true },
      });
      if (!task) return error(c, "Task not found", 404);

      const acceptedPlan = await getAcceptedTaskPlanGraph(taskId);
      if (acceptedPlan) {
        const trigger = task.status === "WaitingForInput" ? "user_provided_input" : "user_message";
        const result = await continuePlanExecution({
          taskId,
          reason: trigger,
          userInput: body.message,
        });
        return json(c, { workspaceId: task.workspaceId, ...result });
      }

      let runId = body.runId as string | undefined;
      if (!runId) {
        const latestRun = await db.run.findFirst({
          where: { taskId, status: { in: ["Running", "WaitingForApproval"] } },
          orderBy: { startedAt: "desc" },
          select: { id: true },
        });
        if (!latestRun) {
          return error(c, "No active run found for this task. The agent must be running to receive messages.", 400);
        }
        runId = latestRun.id;
      }
      const adapter = await getOpenClawAdapter();
      return json(c, await sendOperatorMessage({ runId, message: body.message, adapter }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to send message";
      return error(c, message, message.includes("not found") || message.includes("no longer exists") ? 404 : 500);
    }
  });

  api.post("/tasks/:taskId/resume", async (c) => {
    try {
      const body = await c.req.json();
      if (!body.runId) {
        return error(c, "runId is required", 400);
      }
      const adapter = await getOpenClawAdapter();
      return json(
        c,
        await resumeRun({
          runId: body.runId,
          inputText: body.inputText,
          approvalId: body.approvalId,
          adapter,
        }),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to resume run";
      return error(c, message, message.includes("not found") || message.includes("no longer exists") ? 404 : 500);
    }
  });

  api.post("/tasks/:taskId/done", async (c) => {
    try {
      return json(c, await markTaskDone({ taskId: c.req.param("taskId") }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to mark task done";
      return error(c, message, message.includes("not found") || message.includes("No 'Task' record") ? 404 : 400);
    }
  });

  api.post("/tasks/:taskId/reopen", async (c) => {
    try {
      return json(c, await reopenTask({ taskId: c.req.param("taskId") }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to reopen task";
      return error(c, message, message.includes("not found") || message.includes("No 'Task' record") ? 404 : 500);
    }
  });

  api.post("/tasks/:taskId/result/accept", async (c) => {
    try {
      return json(c, await acceptTaskResult({ taskId: c.req.param("taskId") }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to accept task result";
      return error(c, message, message.includes("not found") ? 404 : 400);
    }
  });

  api.post("/tasks/:taskId/follow-up", async (c) => {
    try {
      const body = await c.req.json();
      if (!body.title || (typeof body.title === "string" && !body.title.trim())) {
        return error(c, "title is required", 400);
      }
      return json(
        c,
        await createFollowUpTask({
          taskId: c.req.param("taskId"),
          title: body.title,
          dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
          priority: body.priority,
        }),
        201,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to create follow-up task";
      return error(c, message, message.includes("not found") ? 404 : 500);
    }
  });

  api.post("/tasks/:taskId/schedule", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();

      if (!body.scheduledStartAt || !body.scheduledEndAt) {
        return error(c, "scheduledStartAt and scheduledEndAt are required", 400);
      }

      return json(
        c,
        await applySchedule({
          taskId,
          scheduledStartAt: new Date(body.scheduledStartAt),
          scheduledEndAt: new Date(body.scheduledEndAt),
          dueAt: body.dueAt ? new Date(body.dueAt) : null,
          scheduleSource: body.scheduleSource ?? "system",
        }),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to apply schedule";
      return error(c, message, message.includes("not found") || message.includes("No 'Task' record") ? 404 : 500);
    }
  });

  api.delete("/tasks/:taskId/schedule", async (c) => {
    try {
      return json(c, await clearSchedule({ taskId: c.req.param("taskId") }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to clear schedule";
      return error(c, message, message.includes("not found") || message.includes("No 'Task' record") ? 404 : 500);
    }
  });

  api.post("/tasks/:taskId/schedule/proposals", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : undefined;
      if (workspaceId) {
        await ensureTaskInWorkspace(taskId, workspaceId);
      }

      const dueAt = toDateOrNull(body.dueAt);
      const scheduledStartAt = toDateOrNull(body.scheduledStartAt);
      const scheduledEndAt = toDateOrNull(body.scheduledEndAt);
      ensureValidDateFields({ dueAt, scheduledStartAt, scheduledEndAt });

      return json(
        c,
        await proposeSchedule({
          taskId,
          source: body.source,
          proposedBy: body.proposedBy,
          summary: body.summary,
          dueAt,
          scheduledStartAt,
          scheduledEndAt,
          assigneeAgentId: typeof body.assigneeAgentId === "string" ? body.assigneeAgentId : null,
        }),
        201,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to create schedule proposal";
      return error(
        c,
        message,
        message.includes("not found")
          ? 404
          : message.includes("scheduledEndAt cannot be earlier than scheduledStartAt") ||
              message.includes("must be a valid date string")
            ? 400
            : 500,
      );
    }
  });

  api.post("/schedule/proposals/decision", async (c) => {
    try {
      const body = await c.req.json();
      const proposalId = typeof body.proposalId === "string" ? body.proposalId : "";
      const decision = body.decision;
      const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : undefined;

      if (!proposalId) {
        return error(c, "proposalId is required", 400);
      }

      if (decision !== "Accepted" && decision !== "Rejected") {
        return error(c, 'decision must be "Accepted" or "Rejected"', 400);
      }

      if (workspaceId) {
        await ensureProposalInWorkspace(proposalId, workspaceId);
      }

      return json(
        c,
        await decideScheduleProposal({
          proposalId,
          decision,
          resolutionNote: typeof body.resolutionNote === "string" ? body.resolutionNote : undefined,
        }),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to resolve schedule proposal";
      return error(
        c,
        message,
        message.includes("Schedule proposal not found") ||
          message.includes("No 'ScheduleProposal' record") ||
          message.includes("not found")
          ? 404
          : message.includes("Only pending schedule proposals can be resolved.")
            ? 409
            : 400,
      );
    }
  });

  api.post("/approvals/:approvalId/resolve", async (c) => {
    try {
      const approvalId = c.req.param("approvalId");
      const body = await c.req.json();
      return json(
        c,
        await resolveApproval({
          approvalId,
          decision: body.decision,
          resolutionNote: body.resolutionNote,
          editedContent: body.editedContent,
        }),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to resolve approval";
      return error(c, message, message.includes("no longer exists") || message.includes("not found") ? 404 : 400);
    }
  });

  api.post("/tasks/:taskId/approvals/:approvalId/resolve", async (c) => {
    try {
      const approvalId = c.req.param("approvalId");
      const body = await c.req.json();
      return json(
        c,
        await resolveApproval({
          approvalId,
          decision: body.decision,
          resolutionNote: body.resolutionNote,
          editedContent: body.editedContent,
        }),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to resolve approval";
      return error(c, message, message.includes("no longer exists") || message.includes("not found") ? 404 : 400);
    }
  });

  api.post("/memories/:memoryId/invalidate", async (c) => {
    try {
      return json(c, await invalidateMemory({ memoryId: c.req.param("memoryId") }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to invalidate memory";
      return error(c, message, message.includes("not found") ? 404 : 500);
    }
  });

  api.post("/tasks/:taskId/assistant/messages", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      const { role, content, proposal } = body as {
        role: string;
        content: string;
        proposal?: Record<string, unknown> | null;
      };

      if (!role || !content) {
        return error(c, "role and content are required", 400);
      }
      if (role !== "user" && role !== "assistant") {
        return error(c, "role must be 'user' or 'assistant'", 400);
      }

      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) return error(c, "Task not found", 404);

      const lastMsg = await db.taskAssistantMessage.findFirst({
        where: { taskId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      const sequence = (lastMsg?.sequence ?? -1) + 1;

      const message = await db.taskAssistantMessage.create({
        data: {
          taskId,
          role,
          content,
          proposal: proposal ? JSON.stringify(proposal) : null,
          sequence,
        },
      });

      return json(c, {
        id: message.id,
        taskId: message.taskId,
        role: message.role,
        content: message.content,
        proposal: message.proposal ? (JSON.parse(message.proposal) as Record<string, unknown>) : null,
        applied: message.applied,
        appliedAt: message.appliedAt,
        sequence: message.sequence,
        createdAt: message.createdAt,
      }, 201);
    } catch (cause) {
      return internalServerError(c, "POST /api/tasks/:taskId/assistant/messages", cause, "Failed to save message");
    }
  });

  api.get("/tasks/:taskId/assistant/messages", async (c) => {
    try {
      const taskId = c.req.param("taskId");

      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) return error(c, "Task not found", 404);

      const messages = await db.taskAssistantMessage.findMany({
        where: { taskId },
        orderBy: { sequence: "asc" },
      });

      return json(c, {
        messages: messages.map((m) => ({
          id: m.id,
          taskId: m.taskId,
          role: m.role,
          content: m.content,
          proposal: m.proposal ? (JSON.parse(m.proposal) as Record<string, unknown>) : null,
          applied: m.applied,
          appliedAt: m.appliedAt,
          sequence: m.sequence,
          createdAt: m.createdAt,
        })),
      });
    } catch (cause) {
      return internalServerError(c, "GET /api/tasks/:taskId/assistant/messages", cause, "Failed to fetch messages");
    }
  });

  api.patch("/tasks/:taskId/assistant/messages/:messageId/apply", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const messageId = c.req.param("messageId");

      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) return error(c, "Task not found", 404);

      const existing = await db.taskAssistantMessage.findFirst({
        where: { id: messageId, taskId },
      });
      if (!existing) return error(c, "Message not found", 404);

      const message = await db.taskAssistantMessage.update({
        where: { id: messageId },
        data: { applied: true, appliedAt: new Date() },
      });

      return json(c, {
        id: message.id,
        taskId: message.taskId,
        role: message.role,
        content: message.content,
        proposal: message.proposal ? (JSON.parse(message.proposal) as Record<string, unknown>) : null,
        applied: message.applied,
        appliedAt: message.appliedAt,
        sequence: message.sequence,
        createdAt: message.createdAt,
      });
    } catch (cause) {
      return internalServerError(c, "PATCH /api/tasks/:taskId/assistant/messages/:messageId/apply", cause, "Failed to mark applied");
    }
  });

  return api;
}
