import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { suggestTimeslots } from "@/modules/ai/timeslot-suggester";
import type { ScheduleSlot } from "@/modules/ai/types";

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

    // Look up the task
    const task = await db.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 },
      );
    }

    // Determine the target date
    let targetDate: Date;
    if (date) {
      targetDate = new Date(date);
    } else {
      targetDate = new Date();
    }
    targetDate.setHours(0, 0, 0, 0);

    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // Look up currently scheduled tasks for the date from TaskProjection
    const projections = await db.taskProjection.findMany({
      where: {
        workspaceId,
        scheduledStartAt: {
          gte: targetDate,
          lt: nextDay,
        },
        // Exclude the task itself from the current schedule
        NOT: {
          taskId,
        },
      },
      include: {
        task: {
          select: {
            title: true,
          },
        },
      },
    });

    // Convert projections to ScheduleSlot format
    const currentSchedule: ScheduleSlot[] = projections
      .filter((p) => p.scheduledStartAt !== null && p.scheduledEndAt !== null)
      .map((p) => ({
        taskId: p.taskId,
        title: p.task?.title ?? "Untitled",
        startAt: p.scheduledStartAt!,
        endAt: p.scheduledEndAt!,
      }));

    // Estimate duration: use scheduledEndAt - scheduledStartAt if available,
    // otherwise default to 60 minutes
    let estimatedMinutes = 60;
    if (task.scheduledStartAt && task.scheduledEndAt) {
      estimatedMinutes = Math.round(
        (new Date(task.scheduledEndAt).getTime() -
          new Date(task.scheduledStartAt).getTime()) /
          60_000,
      );
    }

    // Call the suggestion engine
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
