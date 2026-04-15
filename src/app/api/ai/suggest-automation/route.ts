import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { suggestAutomationSmart } from "@/modules/ai/automation-suggester";
import type { TaskAutomationInput } from "@/modules/ai/types";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskId, title, description, priority, dueAt, scheduledStartAt, scheduledEndAt, isRunnable, runnabilityState, ownerType } = body;

    // Accept either taskId (DB lookup) or raw fields
    if (!taskId && !title) {
      return NextResponse.json(
        { error: "Either taskId or title is required" },
        { status: 400 },
      );
    }

    let input: TaskAutomationInput;

    if (taskId && !title) {
      // DB lookup path
      const task = await db.task.findUnique({
        where: { id: taskId },
      });

      if (!task) {
        return NextResponse.json(
          { error: "Task not found" },
          { status: 404 },
        );
      }

      input = {
        taskId: task.id,
        title: task.title,
        description: task.description ?? "",
        priority: task.priority,
        dueAt: task.dueAt,
        scheduledStartAt: task.scheduledStartAt,
        scheduledEndAt: task.scheduledEndAt,
        isRunnable: !!task.runtimeAdapterKey,
        runnabilityState: task.status ?? "",
        ownerType: task.ownerType ?? "",
      };
    } else {
      // Raw fields path (from client hooks)
      input = {
        taskId: taskId ?? "",
        title,
        description: description ?? "",
        priority: priority ?? "Medium",
        dueAt: dueAt ? new Date(dueAt) : null,
        scheduledStartAt: scheduledStartAt ? new Date(scheduledStartAt) : null,
        scheduledEndAt: scheduledEndAt ? new Date(scheduledEndAt) : null,
        isRunnable: isRunnable ?? false,
        runnabilityState: runnabilityState ?? "",
        ownerType: ownerType ?? "",
      };
    }

    const suggestion = await suggestAutomationSmart(input);

    return NextResponse.json(suggestion);
  } catch (error) {
    console.error("Error suggesting automation:", error);
    return NextResponse.json(
      { error: "Failed to suggest automation" },
      { status: 500 },
    );
  }
}
