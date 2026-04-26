/**
 * OpenClaw Schedule Suggest Plugin
 *
 * This module defines the tool specifications that the OpenClaw agent
 * can use when generating task suggestions.  These tools are registered
 * as an OpenClaw plugin and executed server-side by this application
 * when the agent requests them.
 *
 * The plugin wraps our existing query/API layer — the AI never
 * fabricates IDs or sensitive parameters. Instead, each tool
 * specification only exposes parameters the AI should provide
 * (like search terms or date filters), and the plugin fills in
 * the workspaceId and other system parameters internally.
 *
 * Tool registration flow:
 *   1. Plugin defines tool specs (JSON Schema).
 *   2. When OpenClaw calls a tool, it sends a `session.tool` event
 *      with the tool name and arguments.
 *   3. Our handler receives the event, dispatches to the right
 *      query function, and returns the result.
 *
 * For now, tool execution happens inline via the schedule suggest
 * service. Future: could be exposed as a webhook endpoint.
 */

import { getSchedulePage } from "@/modules/queries/get-schedule-page";
import { getTaskCenter } from "@/modules/queries/get-task-center";

// ────────────────────────────────────────────────────────────────────────
// Tool Specifications (for OpenClaw registration)
// ────────────────────────────────────────────────────────────────────────

/**
 * Tool definitions that get sent to the OpenClaw agent.
 * These follow the OpenAI function calling schema format
 * that OpenClaw understands.
 */
export const SCHEDULE_SUGGEST_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "schedule.list_tasks",
      description:
        "List existing tasks in the user's workspace. Use this to check for duplicate tasks or understand what the user is already working on.",
      parameters: {
        type: "object",
        properties: {
          status_filter: {
            type: "string",
            enum: [
              "all",
              "scheduled",
              "unscheduled",
              "running",
              "overdue",
            ],
            description:
              "Filter tasks by status. Default: 'all'.",
          },
          limit: {
            type: "number",
            description:
              "Max tasks to return. Default: 10.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "schedule.get_health",
      description:
        "Get the current schedule health metrics including today's load, conflict count, overdue count, and available time windows. Use this to suggest appropriate priorities and durations.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "schedule.check_conflicts",
      description:
        "Check if a proposed time window has conflicts with existing tasks. Use this to suggest conflict-free scheduling.",
      parameters: {
        type: "object",
        properties: {
          start_time: {
            type: "string",
            description:
              "Proposed start time in ISO 8601 format.",
          },
          end_time: {
            type: "string",
            description:
              "Proposed end time in ISO 8601 format.",
          },
        },
        required: ["start_time", "end_time"],
      },
    },
  },
];

// ────────────────────────────────────────────────────────────────────────
// Tool execution
// ────────────────────────────────────────────────────────────────────────

export interface ToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
  workspaceId: string;
}

export interface ToolCallResult {
  success: boolean;
  data: unknown;
  error?: string;
}

/**
 * Execute a tool call from the OpenClaw agent.
 * The workspaceId is injected by our service, NOT by the AI.
 */
export async function executeScheduleTool(
  request: ToolCallRequest,
): Promise<ToolCallResult> {
  try {
    switch (request.name) {
      case "schedule.list_tasks":
        return await executeListTasks(request);
      case "schedule.get_health":
        return await executeGetHealth(request);
      case "schedule.check_conflicts":
        return await executeCheckConflicts(request);
      default:
        return {
          success: false,
          data: null,
          error: `Unknown tool: ${request.name}`,
        };
    }
  } catch (err) {
    return {
      success: false,
      data: null,
      error:
        err instanceof Error
          ? err.message
          : "Tool execution failed",
    };
  }
}

type TaskCenterFilter = "Running" | "WaitingForApproval" | "Blocked" | "Failed" | "Unscheduled" | "Overdue";

async function executeListTasks(
  request: ToolCallRequest,
): Promise<ToolCallResult> {
  const filter = (request.arguments.status_filter as string) ?? undefined;
  const limit = (request.arguments.limit as number) ?? 10;

  // Map our filter to getTaskCenter's filter format
  let taskCenterFilter: TaskCenterFilter | undefined;
  switch (filter) {
    case "running":
      taskCenterFilter = "Running";
      break;
    case "overdue":
      taskCenterFilter = "Overdue";
      break;
    case "unscheduled":
      taskCenterFilter = "Unscheduled";
      break;
    default:
      taskCenterFilter = undefined;
  }

  const projections = await getTaskCenter(request.workspaceId, taskCenterFilter);
  const tasks = projections.slice(0, limit).map((t) => ({
    taskId: t.taskId,
    title: t.title,
    status: t.persistedStatus,
    displayState: t.displayState,
    scheduleStatus: t.scheduleStatus,
    dueAt: t.dueAt,
  }));

  return { success: true, data: { tasks, total: projections.length } };
}

async function executeGetHealth(
  request: ToolCallRequest,
): Promise<ToolCallResult> {
  const scheduleData = await getSchedulePage(request.workspaceId);

  return {
    success: true,
    data: {
      summary: scheduleData.planningSummary,
      focusZones: scheduleData.focusZones,
      conflictCount: scheduleData.conflicts.length,
      riskCount: scheduleData.risks.length,
      automationCandidateCount:
        scheduleData.automationCandidates.length,
    },
  };
}

async function executeCheckConflicts(
  request: ToolCallRequest,
): Promise<ToolCallResult> {
  const startTime = request.arguments.start_time as string;
  const endTime = request.arguments.end_time as string;

  if (!startTime || !endTime) {
    return {
      success: false,
      data: null,
      error: "start_time and end_time are required",
    };
  }

  const scheduleData = await getSchedulePage(request.workspaceId);
  const proposedStart = new Date(startTime).getTime();
  const proposedEnd = new Date(endTime).getTime();

  // Check for overlaps with scheduled items
  const conflicts = scheduleData.listItems
    .filter((item) => {
      if (!item.scheduledStartAt || !item.scheduledEndAt) return false;
      const itemStart = new Date(item.scheduledStartAt).getTime();
      const itemEnd = new Date(item.scheduledEndAt).getTime();
      return proposedStart < itemEnd && proposedEnd > itemStart;
    })
    .map((item) => ({
      taskId: item.taskId,
      title: item.title,
      scheduledStartAt: item.scheduledStartAt,
      scheduledEndAt: item.scheduledEndAt,
    }));

  return {
    success: true,
    data: {
      hasConflicts: conflicts.length > 0,
      conflictingTasks: conflicts,
    },
  };
}
