import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { provideInput } from "@/modules/commands/provide-input";
import { createRuntimeAdapter, type OpenClawAdapter } from "@/modules/runtime/openclaw/adapter";

/**
 * POST /api/tasks/[taskId]/input — Provide input to a waiting agent.
 * Body: { inputText, runId? }
 *
 * If runId is not provided, the latest run waiting for input is used.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const body = await request.json();

    if (!body.inputText || (typeof body.inputText === "string" && !body.inputText.trim())) {
      return NextResponse.json(
        { error: "inputText is required" },
        { status: 400 },
      );
    }

    let runId = body.runId;

    if (!runId) {
      // Find the latest run waiting for input
      const latestRun = await db.run.findFirst({
        where: {
          taskId,
          status: "WaitingForInput",
        },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      });

      if (!latestRun) {
        return NextResponse.json(
          { error: "No run waiting for input found for this task." },
          { status: 400 },
        );
      }

      runId = latestRun.id;
    }

    const adapter = await createRuntimeAdapter();

    const result = await provideInput({
      runId,
      inputText: body.inputText,
      adapter: adapter as OpenClawAdapter,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to provide input";
    console.error("POST /api/tasks/[taskId]/input error:", message);

    if (message.includes("not found") || message.includes("no longer exists")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
