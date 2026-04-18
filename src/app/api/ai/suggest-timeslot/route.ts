import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiSuggestTimeslots } from "@/modules/ai/ai-service";
import { suggestTimeslots } from "@/modules/ai/timeslot-suggester";
import type { ScheduleSlot } from "@/modules/ai/types";
import type { TaskSnapshot } from "@/modules/ai/ai-service";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { workspaceId, taskId, date } = body;

    if (!workspaceId || !taskId) {
      return NextResponse.json(
        { error: "workspaceId and taskId are required" },
        { status: 400 },
      );
    }

    const task = await db.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    let targetDate: Date;
    if (date) {
      targetDate = new Date(date);
    } else {
      targetDate = new Date();
    }
    targetDate.setHours(0, 0, 0, 0);

    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const projections = await db.taskProjection.findMany({
      where: {
        workspaceId,
        scheduledStartAt: { gte: targetDate, lt: nextDay },
        NOT: { taskId },
      },
      include: { task: { select: { title: true, priority: true, status: true } } },
    });

    let estimatedMinutes = 60;
    if (task.scheduledStartAt && task.scheduledEndAt) {
      estimatedMinutes = Math.round(
        (new Date(task.scheduledEndAt).getTime() -
          new Date(task.scheduledStartAt).getTime()) /
          60_000,
      );
    }

    // Try adapter layer first
    const taskSnapshots: TaskSnapshot[] = projections
      .filter((p) => p.scheduledStartAt && p.scheduledEndAt)
      .map((p) => ({
        id: p.taskId,
        title: p.task?.title ?? "",
        status: p.task?.status ?? "open",
        priority: p.task?.priority ?? undefined,
        scheduledStartAt: p.scheduledStartAt!.toISOString(),
        scheduledEndAt: p.scheduledEndAt!.toISOString(),
      }));

    const adapterResult = await aiSuggestTimeslots({
      taskTitle: task.title,
      estimatedMinutes,
      priority: task.priority as "Low" | "Medium" | "High" | "Urgent" | undefined,
      deadline: task.dueAt?.toISOString(),
      currentSchedule: taskSnapshots,
    });

    if (adapterResult) {
      return NextResponse.json(adapterResult);
    }

    // Fallback to existing rule-based logic
    const currentSchedule: ScheduleSlot[] = projections
      .filter((p) => p.scheduledStartAt !== null && p.scheduledEndAt !== null)
      .map((p) => ({
        taskId: p.taskId,
        title: p.task?.title ?? "Untitled",
        startAt: p.scheduledStartAt!,
        endAt: p.scheduledEndAt!,
      }));

    const result = suggestTimeslots({
      taskId: task.id,
      title: task.title,
      priority: task.priority,
      estimatedMinutes,
      dueAt: task.dueAt,
      currentSchedule,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error suggesting timeslot:", error);
    return NextResponse.json(
      { error: "Failed to suggest timeslot" },
      { status: 500 },
    );
  }
}
