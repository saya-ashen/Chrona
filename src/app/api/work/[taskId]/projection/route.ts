import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getWorkPage } from "@/modules/queries/get-work-page";
import { createRuntimeAdapter } from "@/modules/runtime/openclaw/adapter";
import { syncRunFromRuntime } from "@/modules/runtime/openclaw/sync-run";

const ACTIVE_RUN_STATUSES = ["Pending", "Running", "WaitingForApproval", "WaitingForInput"];

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await context.params;
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const currentRun = task.runs[0];

  if (currentRun && ACTIVE_RUN_STATUSES.includes(currentRun.status)) {
    try {
      const adapter = await createRuntimeAdapter();
      await syncRunFromRuntime({ runId: currentRun.id, adapter });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Work projection sync failed";
      const now = new Date();

      await db.run.update({
        where: { id: currentRun.id },
        data: {
          syncStatus: "degraded",
          mappingPartial: true,
          lastSyncedAt: now,
        },
      });

      await db.runtimeCursor.upsert({
        where: { runId: currentRun.id },
        update: {
          runtimeName: currentRun.runtimeName,
          lastSyncedAt: now,
          healthStatus: "degraded",
          lastError: message,
        },
        create: {
          runId: currentRun.id,
          runtimeName: currentRun.runtimeName,
          lastSyncedAt: now,
          healthStatus: "degraded",
          lastError: message,
        },
      });
    }
  }

  return NextResponse.json(await getWorkPage(taskId));
}
