import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { startRun } from "@/modules/commands/start-run";
import type { OpenClawAdapter } from "@/modules/runtime/openclaw/adapter";

export async function retryRun(input: {
  taskId: string;
  prompt?: string;
  adapter?: OpenClawAdapter;
}) {
  const latestRun = await db.run.findFirst({
    where: { taskId: input.taskId },
    orderBy: { createdAt: "desc" },
  });

  if (!latestRun) {
    throw new Error("Cannot retry a task that has never run.");
  }

  const stoppedStatuses = [RunStatus.Failed, RunStatus.Cancelled, RunStatus.Completed];

  if (!stoppedStatuses.some((status) => status === latestRun.status)) {
    throw new Error("Retry is only allowed after a stopped run.");
  }

  return startRun(input);
}
