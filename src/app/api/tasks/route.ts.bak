import { NextResponse } from "next/server";
import { TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { createTask } from "@/modules/commands/create-task";

const VALID_TASK_STATUSES = new Set(Object.values(TaskStatus));

/**
 * GET /api/tasks — List tasks for a workspace.
 * Query params: workspaceId (required), status? (filter), limit? (default 50)
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    const status = url.searchParams.get("status");
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 200) : 50;

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId query parameter is required" },
        { status: 400 },
      );
    }

    if (status && !VALID_TASK_STATUSES.has(status as TaskStatus)) {
      return NextResponse.json(
        { error: `Invalid status. Valid values: ${[...VALID_TASK_STATUSES].join(", ")}` },
        { status: 400 },
      );
    }

    const tasks = await db.task.findMany({
      where: { workspaceId, ...(status ? { status: status as TaskStatus } : {}) },
      include: { projection: true },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    return NextResponse.json({ tasks, count: tasks.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list tasks";
    console.error("GET /api/tasks error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/tasks — Create a new task.
 * Body: { workspaceId, title, description?, priority?, dueAt?, runtimeAdapterKey?,
 *         runtimeInput?, runtimeInputVersion?, runtimeModel?, prompt?, runtimeConfig? }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { workspaceId, title } = body;

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 },
      );
    }

    if (!title || (typeof title === "string" && !title.trim())) {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 },
      );
    }

    const result = await createTask({
      workspaceId,
      title,
      description: body.description,
      priority: body.priority,
      dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
      runtimeAdapterKey: body.runtimeAdapterKey,
      runtimeInput: body.runtimeInput,
      runtimeInputVersion: body.runtimeInputVersion,
      runtimeModel: body.runtimeModel,
      prompt: body.prompt,
      runtimeConfig: body.runtimeConfig,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create task";
    console.error("POST /api/tasks error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
