import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";

export async function acceptTaskResult(input: { taskId: string }) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  const latestRun = task.runs[0] ?? null;

  if (!latestRun || latestRun.status !== "Completed") {
    throw new Error("Only completed runs can be accepted.");
  }

  await appendCanonicalEvent({
    eventType: "task.result_accepted",
    workspaceId: task.workspaceId,
    taskId: task.id,
    runId: latestRun.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      accepted_run_id: latestRun.id,
      accepted_at: new Date().toISOString(),
    },
    dedupeKey: `task.result_accepted:${task.id}:${latestRun.id}`,
  });

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
    runId: latestRun.id,
  };
}
