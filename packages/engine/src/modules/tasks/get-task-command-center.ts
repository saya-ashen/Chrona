import { db } from "@/lib/db";
import { buildCommandCenterArtifactsSpec, buildCommandCenterTrailSpec } from "@chrona/ui-protocol";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import {
  buildActivityTimeline,
  mapTimelineItemToActivity,
  orderActivityNewestFirst,
} from "./task-activity";

export async function getTaskCommandCenter(input: { taskId: string; workBlockId?: string | null }) {
  const selectedWorkBlockId = input.workBlockId ?? null;
  const task = await db.task.findUnique({
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
  });
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
    artifacts,
    activityTimeline,
    ui: {
      commandCenter: {
        artifactsSpec: buildCommandCenterArtifactsSpec({ artifacts }),
        trailSpec: buildCommandCenterTrailSpec({
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
    },
  };
}
