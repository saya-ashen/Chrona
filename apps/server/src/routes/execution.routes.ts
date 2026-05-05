import { Hono } from "hono";

import {
  acceptTaskResult,
  applyAssistantMessage,
  applySchedule,
  clearSchedule,
  continuePlanExecution,
  createFollowUpTask,
  decideScheduleProposal,
  ensureProposalInWorkspace,
  ensureTaskInWorkspace,
  getAcceptedCompiledPlan,
  getAssistantMessages,
  getTaskOrThrow,
  invalidateMemory,
  markTaskDone,
  proposeSchedule,
  reopenTask,
  resolveApproval,
  saveAssistantMessage,
  startPlanExecution,
} from "@chrona/engine";

import {
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

      const task = await getTaskOrThrow(taskId);

      const acceptedPlan = await getAcceptedCompiledPlan(taskId);
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

  api.post("/tasks/:taskId/retry", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json().catch(() => ({}));

      const task = await getTaskOrThrow(taskId);

      const acceptedPlan = await getAcceptedCompiledPlan(taskId);
      if (!acceptedPlan) {
        return error(c, "No accepted plan. Create or accept a plan before execution.", 400);
      }

      const result = await startPlanExecution({
        taskId,
        trigger: "manual",
        prompt: body.prompt,
      });
      return json(c, { workspaceId: task.workspaceId, ...result });
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

      const task = await getTaskOrThrow(taskId);

      const acceptedPlan = await getAcceptedCompiledPlan(taskId);
      if (!acceptedPlan) {
        return error(c, "No accepted plan. Create or accept a plan before execution.", 400);
      }
      if (task.status !== "WaitingForInput") {
        return error(c, "Task is not currently waiting for input.", 409);
      }

      const result = await continuePlanExecution({
        taskId,
        reason: "user_provided_input",
        userInput: body.inputText,
      });
      return json(c, { workspaceId: task.workspaceId, ...result });
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

      const task = await getTaskOrThrow(taskId);

      const acceptedPlan = await getAcceptedCompiledPlan(taskId);
      if (!acceptedPlan) {
        return error(c, "No accepted plan. Create or accept a plan before execution.", 400);
      }

      const trigger = task.status === "WaitingForInput" ? "user_provided_input" : "user_message";
      const result = await continuePlanExecution({
        taskId,
        reason: trigger,
        userInput: body.message,
      });
      return json(c, { workspaceId: task.workspaceId, ...result });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to send message";
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

      const message = await saveAssistantMessage({
        taskId,
        role,
        content,
        proposal,
      });

      return json(c, {
        id: message.id,
        taskId: message.taskId,
        role: message.role,
        content: message.content,
        proposal: message.proposal ?? null,
        applied: message.applied,
        appliedAt: message.appliedAt,
        sequence: message.sequence,
        createdAt: message.createdAt,
      }, 201);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to save message";
      if (message.includes("Task not found")) {
        return error(c, "Task not found", 404);
      }
      return internalServerError(c, "POST /api/tasks/:taskId/assistant/messages", cause, "Failed to save message");
    }
  });

  api.get("/tasks/:taskId/assistant/messages", async (c) => {
    try {
      const taskId = c.req.param("taskId");

      const messages = await getAssistantMessages(taskId);

      return json(c, {
        messages: messages.map((m) => ({
          id: m.id,
          taskId: m.taskId,
          role: m.role,
          content: m.content,
          proposal: m.proposal ?? null,
          applied: m.applied,
          appliedAt: m.appliedAt,
          sequence: m.sequence,
          createdAt: m.createdAt,
        })),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to fetch messages";
      if (message.includes("Task not found")) {
        return error(c, "Task not found", 404);
      }
      return internalServerError(c, "GET /api/tasks/:taskId/assistant/messages", cause, "Failed to fetch messages");
    }
  });

  api.patch("/tasks/:taskId/assistant/messages/:messageId/apply", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const messageId = c.req.param("messageId");

      const message = await applyAssistantMessage(messageId, taskId);

      return json(c, {
        id: message.id,
        taskId: message.taskId,
        role: message.role,
        content: message.content,
        proposal: message.proposal ?? null,
        applied: message.applied,
        appliedAt: message.appliedAt,
        sequence: message.sequence,
        createdAt: message.createdAt,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to mark applied";
      if (message.includes("Task not found")) {
        return error(c, "Task not found", 404);
      }
      if (message.includes("Message not found")) {
        return error(c, "Message not found", 404);
      }
      return internalServerError(c, "PATCH /api/tasks/:taskId/assistant/messages/:messageId/apply", cause, "Failed to mark applied");
    }
  });

  return api;
}
