import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiAnalyzeConflicts } from "@/modules/ai/ai-service";
import { analyzeConflictsSmart } from "@/modules/ai/conflict-analyzer";
import type { ScheduledTaskInfo } from "@/modules/ai/types";
import type { TaskSnapshot } from "@/modules/ai/adapters/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { workspaceId, date } = body;

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 },
      );
    }

    let startDate: Date;
    let endDate: Date;

    if (date) {
      startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
    } else {
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 7);
    }

    const projections = await db.taskProjection.findMany({
      where: {
        workspaceId,
        scheduledStartAt: { gte: startDate, lt: endDate },
      },
      include: {
        task: {
          include: {
            dependencies: { select: { dependsOnTaskId: true } },
          },
        },
      },
    });

    const validProjections = projections.filter(
      (p) => p.scheduledStartAt !== null && p.scheduledEndAt !== null && p.task !== null,
    );

    // Try adapter layer first
    const taskSnapshots: TaskSnapshot[] = validProjections.map((p) => ({
      id: p.taskId,
      title: p.task.title,
      status: p.task.status,
      priority: p.task.priority ?? undefined,
      scheduledStartAt: p.scheduledStartAt!.toISOString(),
      scheduledEndAt: p.scheduledEndAt!.toISOString(),
    }));

    const adapterResult = await aiAnalyzeConflicts({
      tasks: taskSnapshots,
      workspaceId,
      focusDate: date,
    });

    if (adapterResult) {
      return NextResponse.json(adapterResult);
    }

    // Fallback to existing logic
    const tasks: ScheduledTaskInfo[] = validProjections.map((p) => ({
      taskId: p.taskId,
      title: p.task.title,
      priority: p.task.priority,
      scheduledStartAt: p.scheduledStartAt!,
      scheduledEndAt: p.scheduledEndAt!,
      dueAt: p.task.dueAt,
      estimatedMinutes: Math.round(
        (p.scheduledEndAt!.getTime() - p.scheduledStartAt!.getTime()) / 60000,
      ),
      dependencies: p.task.dependencies.map((d) => d.dependsOnTaskId),
    }));

    const result = await analyzeConflictsSmart(tasks);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error analyzing conflicts:", error);
    return NextResponse.json(
      { error: "Failed to analyze conflicts" },
      { status: 500 },
    );
  }
}
