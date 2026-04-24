import { NextResponse } from "next/server";
import { dispatchNextTaskAction } from "@/modules/commands/dispatch-next-task-action";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const taskId = typeof body.taskId === "string" ? body.taskId : "";
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";

    if (!taskId || !workspaceId) {
      return NextResponse.json(
        { error: "taskId and workspaceId are required" },
        { status: 400 },
      );
    }

    const output = await dispatchNextTaskAction({
      taskId,
      workspaceId,
      mode: "preview",
    });

    return NextResponse.json(output);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to dispatch task" },
      { status: 500 },
    );
  }
}

