import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendOperatorMessage } from "@/modules/commands/send-operator-message";
import { createRuntimeAdapter } from "@/modules/openclaw/adapter";

/**
 * POST /api/tasks/[taskId]/message — Send an operator message to the running agent.
 * Body: { message, runId? }
 *
 * If runId is not provided, the latest active run for the task is used.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const body = await request.json();

    if (!body.message || (typeof body.message === "string" && !body.message.trim())) {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 },
      );
    }

    let runId = body.runId;

    if (!runId) {
      // Find the latest active run for this task
      const latestRun = await db.run.findFirst({
        where: {
          taskId,
          status: { in: ["Running", "WaitingForApproval"] },
        },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      });

      if (!latestRun) {
        return NextResponse.json(
          { error: "No active run found for this task. The agent must be running to receive messages." },
          { status: 400 },
        );
      }

      runId = latestRun.id;
    }

    const adapter = await createRuntimeAdapter();

    const result = await sendOperatorMessage({
      runId,
      message: body.message,
      adapter,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send message";
    console.error("POST /api/tasks/[taskId]/message error:", message);

    if (message.includes("not found") || message.includes("no longer exists")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
