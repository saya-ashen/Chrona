import { db } from "@/lib/db";
import { buildCommandCenterArtifactsSpec, buildCommandCenterNowSpec, buildCommandCenterTrailSpec } from "@chrona/ui-protocol";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import {
  buildActivityTimeline,
  mapTimelineItemToActivity,
  orderActivityNewestFirst,
} from "./task-activity";
import { getCurrentExecution } from "../plan-execution/use-cases/get-current-execution";

function nowTone(status: string) {
  if (status === "completed") return "success" as const;
  if (status === "failed" || status === "blocked") return "danger" as const;
  if (status.startsWith("waiting")) return "warning" as const;
  if (status === "running" || status === "started") return "info" as const;
  return "neutral" as const;
}

function nowTitle(status: string) {
  if (status === "no_plan") return "No accepted plan";
  if (status === "completed") return "Execution complete";
  if (status === "running" || status === "started") return "Execution running";
  if (status.startsWith("waiting")) return "Needs input";
  if (status === "blocked") return "Execution blocked";
  if (status === "failed") return "Execution failed";
  return "Execution status";
}

export async function getTaskCommandCenter(input: { taskId: string; workBlockId?: string | null }) {
  const selectedWorkBlockId = input.workBlockId ?? null;
  const [task, currentExecution] = await Promise.all([
    db.task.findUnique({
      where: { id: input.taskId },
      select: {
        artifacts: { orderBy: { createdAt: "desc" }, take: 5 },
        timelineItems: {
          where: selectedWorkBlockId !== null ? { workBlockId: selectedWorkBlockId } : {},
          orderBy: [{ sortTime: "desc" }, { createdAt: "desc" }],
          take: 100,
        },
        events: {
          where: selectedWorkBlockId !== null ? { workBlockId: selectedWorkBlockId } : {},
          orderBy: { ingestSequence: "desc" },
          take: 300,
        },
      },
    }),
    getCurrentExecution({ taskId: input.taskId, workBlockId: selectedWorkBlockId }),
  ]);
  if (!task) {
    throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found");
  }

  const artifacts = task.artifacts.map((artifact) => ({
    id: artifact.id,
    title: artifact.title,
    type: artifact.type,
    uri: artifact.uri,
  }));
  const activityTimeline = task.timelineItems.length > 0
    ? orderActivityNewestFirst([
        ...task.timelineItems.map(mapTimelineItemToActivity),
        ...buildActivityTimeline([...task.events].reverse()),
      ]).slice(0, 100)
    : buildActivityTimeline([...task.events].reverse());

  return {
    documents: {
      now: buildCommandCenterNowSpec({
        title: nowTitle(currentExecution.status),
        description: currentExecution.message,
        statusLabel: currentExecution.status,
        tone: nowTone(currentExecution.status),
        currentOperationSpec: currentExecution.ui?.currentOperationSpec ?? null,
      }),
      output: buildCommandCenterArtifactsSpec({ artifacts }),
      trail: buildCommandCenterTrailSpec({
        activity: activityTimeline,
        savedCount: activityTimeline.length,
        toolLabels: {
          tool: "Tool",
          input: "Input",
          preview: "Preview",
          duration: "Duration",
          error: "Error",
        },
      }),
    },
  };
}
