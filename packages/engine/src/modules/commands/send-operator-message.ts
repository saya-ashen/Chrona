import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { createRuntimeExecutionAdapter } from "@/modules/task-execution/execution-registry";
import type { OpenClawAdapter } from "@chrona/openclaw";
import { syncRunFromRuntime } from "@/modules/runtime-sync/sync-run";
import { resolveTaskSessionKey } from "@/modules/task-execution/task-sessions";
import type { RuntimeExecutionAdapter } from "@chrona/runtime-core";

const MESSAGEABLE_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  RunStatus.Running,
  RunStatus.WaitingForApproval,
]);

export async function sendOperatorMessage(input: {
  runId: string;
  message: string;
  adapter?: RuntimeExecutionAdapter;
}) {
  const message = input.message.trim();

  if (!message) {
    throw new Error("message is required");
  }

  const run = await db.run.findUnique({
    where: { id: input.runId },
    include: { task: true, taskSession: true },
  });

  if (!run) {
    throw new Error("The run no longer exists. Refresh the work page and try again.");
  }

  if (!MESSAGEABLE_RUN_STATUSES.has(run.status)) {
    throw new Error("Operator messages can only be sent while the run is active or waiting on approval.");
  }

  const runtimeSessionKey = resolveTaskSessionKey(run);

  if (!runtimeSessionKey) {
    throw new Error("Cannot send a message without a runtime session key.");
  }

  const adapter = input.adapter ?? (await createRuntimeExecutionAdapter(run.runtimeName));
  const result = await adapter.sendOperatorMessage({
    runtimeSessionKey,
    message,
  });

  if (!result.accepted) {
    throw new Error("Runtime rejected the operator message.");
  }

  await appendCanonicalEvent({
    eventType: "operator.note_added",
    workspaceId: run.task.workspaceId,
    taskId: run.taskId,
    runId: run.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      message,
      delivery: "sent_to_runtime",
      prior_status: run.status,
    },
    dedupeKey: `operator.note_added:${run.id}:${Date.now()}`,
  });

  await syncRunFromRuntime({ runId: run.id, adapter: adapter as OpenClawAdapter });

  return {
    taskId: run.taskId,
    workspaceId: run.task.workspaceId,
    runId: run.id,
  };
}
