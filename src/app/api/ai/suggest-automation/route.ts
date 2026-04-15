import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { suggestAutomation } from "@/modules/ai/automation-suggester";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskId } = body;

    if (!taskId) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 },
      );
    }

    const task = await db.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 },
      );
    }

    const suggestion = suggestAutomation({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      ownerType: task.ownerType,
      runtimeAdapterKey: task.runtimeAdapterKey,
      prompt: task.prompt,
    });

    return NextResponse.json(suggestion);
  } catch (error) {
    console.error("Error suggesting automation:", error);
    return NextResponse.json(
      { error: "Failed to suggest automation" },
      { status: 500 },
    );
  }
}
