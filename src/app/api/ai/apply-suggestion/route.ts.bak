import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { StructuredSuggestion } from "@/hooks/use-ai";

/**
 * Apply a structured AI suggestion.
 *
 * Accepts the full suggestion JSON from the frontend. The action.type
 * determines what operation to perform:
 *   - "create_task": create a new task with the suggested fields
 *   - "reschedule": update an existing task's schedule (future)
 *   - "update_task": update fields on an existing task (future)
 *
 * The frontend sends the complete suggestion so the backend doesn't need
 * to re-derive or cache suggestions.
 */

interface ApplyRequest {
  workspaceId: string;
  /** Full suggestion object from auto-complete response */
  suggestion: StructuredSuggestion;
}

/** Legacy format: array of TaskChange for conflict resolution */
interface LegacyApplyRequest {
  workspaceId: string;
  suggestionId: string;
  changes: Array<{
    taskId: string;
    scheduledStartAt?: string;
    scheduledEndAt?: string;
    priority?: string;
  }>;
}

function isLegacyRequest(body: unknown): body is LegacyApplyRequest {
  return (
    typeof body === "object" &&
    body !== null &&
    "changes" in body &&
    Array.isArray((body as LegacyApplyRequest).changes)
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Support legacy format (conflict resolution changes)
    if (isLegacyRequest(body)) {
      return handleLegacyApply(body);
    }

    const { workspaceId, suggestion } = body as ApplyRequest;

    if (!workspaceId || !suggestion?.action) {
      return NextResponse.json(
        { error: "workspaceId and suggestion with action are required" },
        { status: 400 },
      );
    }

    const { action } = suggestion;

    switch (action.type) {
      case "create_task":
        return handleCreateTask(workspaceId, suggestion);
      default:
        return NextResponse.json(
          { error: `Unknown action type: ${action.type}` },
          { status: 400 },
        );
    }
  } catch (error) {
    console.error("Error applying suggestion:", error);
    return NextResponse.json(
      { error: "Failed to apply suggestion" },
      { status: 500 },
    );
  }
}

// ────────────────────────────────────────────────────────────────────
// Action Handlers
// ────────────────────────────────────────────────────────────────────

async function handleCreateTask(
  workspaceId: string,
  suggestion: StructuredSuggestion,
) {
  const { action } = suggestion;
  const taskId = randomUUID();
  const now = new Date();

  // Create the task
  const task = await db.task.create({
    data: {
      id: taskId,
      workspaceId,
      title: action.title,
      description: action.description || null,
      priority: action.priority,
      status: "Draft",
      scheduleStatus: action.scheduledStartAt ? "Scheduled" : "Unscheduled",
      scheduleSource: "ai",
      scheduledStartAt: action.scheduledStartAt
        ? new Date(action.scheduledStartAt)
        : null,
      scheduledEndAt: action.scheduledEndAt
        ? new Date(action.scheduledEndAt)
        : null,
      ownerType: "human",
      createdAt: now,
      updatedAt: now,
    },
  });

  // Create projection
  await db.taskProjection.upsert({
    where: { taskId },
    create: {
      taskId,
      workspaceId,
      persistedStatus: "Draft",
      scheduledStartAt: action.scheduledStartAt
        ? new Date(action.scheduledStartAt)
        : null,
      scheduledEndAt: action.scheduledEndAt
        ? new Date(action.scheduledEndAt)
        : null,
      updatedAt: now,
    },
    update: {
      scheduledStartAt: action.scheduledStartAt
        ? new Date(action.scheduledStartAt)
        : null,
      scheduledEndAt: action.scheduledEndAt
        ? new Date(action.scheduledEndAt)
        : null,
      updatedAt: now,
    },
  });

  return NextResponse.json({
    success: true,
    taskId,
    suggestionId: suggestion.id,
    action: action.type,
    summary: suggestion.summary,
  });
}

// ────────────────────────────────────────────────────────────────────
// Legacy handler (conflict resolution changes)
// ────────────────────────────────────────────────────────────────────

async function handleLegacyApply(body: LegacyApplyRequest) {
  const { workspaceId, suggestionId, changes } = body;

  if (!workspaceId || !suggestionId || !changes) {
    return NextResponse.json(
      { error: "workspaceId, suggestionId, and changes are required" },
      { status: 400 },
    );
  }

  const taskIds = changes.map((c) => c.taskId);
  const tasks = await db.task.findMany({
    where: {
      id: { in: taskIds },
      workspaceId,
    },
  });

  if (tasks.length !== taskIds.length) {
    return NextResponse.json(
      { error: "Some tasks do not belong to this workspace" },
      { status: 403 },
    );
  }

  const updatePromises = changes.map((change) => {
    const updateData: {
      scheduledStartAt?: Date;
      scheduledEndAt?: Date;
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };

    if (change.scheduledStartAt) {
      updateData.scheduledStartAt = new Date(change.scheduledStartAt);
    }
    if (change.scheduledEndAt) {
      updateData.scheduledEndAt = new Date(change.scheduledEndAt);
    }

    return db.taskProjection.update({
      where: {
        taskId: change.taskId,
      },
      data: updateData,
    });
  });

  const results = await Promise.all(updatePromises);

  return NextResponse.json({
    success: true,
    appliedChanges: results.length,
    suggestionId,
  });
}
