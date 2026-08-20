import { db } from "@chrona/db/db";
import {
  buildCommandCenterArtifactsSpec,
  buildCommandCenterNowSpec,
  buildCommandCenterTrailSpec,
  type UiDocument,
} from "@chrona/ui-protocol";
import type { AiArtifactRef } from "@chrona/contracts/ai";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import {
  buildActivityTimeline,
  deduplicateProjectedActivity,
  mapTimelineItemToActivity,
  orderActivityNewestFirst,
} from "./task-activity";
import { getCurrentExecution } from "../plan-execution/use-cases/get-current-execution";
import { hydrateFilePreviewSpec, resolveFilePreview } from "./file-preview";
import { aiArtifactRef } from "../plan-execution/use-cases/register-generated-plan-output-artifacts";

function isResultArtifactElement(element: UiDocument["elements"][string]) {
  switch (element.type) {
    case "FileView":
    case "FileRef":
    case "ResultDeliverable":
    case "WorkspaceArtifactItem":
    case "Table":
      return true;
    default:
      return false;
  }
}

function materializeResultArtifactRefs(
  spec: UiDocument,
  artifacts: Array<{ id: string; uri: string }>,
): UiDocument {
  const uriByRef = new Map(
    artifacts.map((artifact) => [aiArtifactRef(artifact.id), artifact.uri]),
  );
  return {
    ...spec,
    elements: Object.fromEntries(
      Object.entries(spec.elements).map(([key, element]) => {
        if (!isResultArtifactElement(element)) return [key, element];
        const props = element.props as Record<string, unknown>;
        const opaqueRef =
          typeof props.artifactRef === "string"
            ? props.artifactRef
            : typeof props.path === "string" && props.path.startsWith("AF")
              ? props.path
              : typeof props.uri === "string" && props.uri.startsWith("AF")
                ? props.uri
                : null;
        const uri = opaqueRef
          ? uriByRef.get(opaqueRef as AiArtifactRef)
          : undefined;
        return uri
          ? [key, { ...element, props: { ...props, path: uri } }]
          : [key, element];
      }),
    ),
  };
}

function nowTone(status: string) {
  if (status === "completed") return "success" as const;
  if (status === "failed" || status === "blocked") return "danger" as const;
  if (status.startsWith("waiting")) return "warning" as const;
  if (status === "running") return "info" as const;
  return "neutral" as const;
}

function nowTitle(status: string) {
  if (status === "no_plan") return "No accepted plan";
  if (status === "started") return "Ready to start";
  if (status === "completed") return "Execution complete";
  if (status === "running") return "Execution running";
  if (status.startsWith("waiting")) return "Needs input";
  if (status === "blocked") return "Execution blocked";
  if (status === "failed") return "Execution failed";
  return "Execution status";
}

/**
 * Command-center read model use case. Returns the json-render documents
 * shown in the right-hand panel of the task workspace: `now / output /
 * trail`. The header spec lives on its own endpoint
 * (`GET /api/tasks/:taskId/workspace/header`) and use case
 * (`getTaskHeaderSpec`) so it can be cached, mutated, and invalidated
 * independently of the command-center bundle.
 */
export async function getTaskCommandCenter(input: {
  taskId: string;
  workBlockId?: string | null;
}) {
  const selectedWorkBlockId = input.workBlockId ?? null;
  const currentExecution = await getCurrentExecution({
    taskId: input.taskId,
    workBlockId: selectedWorkBlockId,
  });
  const scopedEventWhere =
    selectedWorkBlockId !== null
      ? {
          OR: [
            { workBlockId: selectedWorkBlockId },
            ...(currentExecution.mainSessionId
              ? [
                  {
                    workBlockId: null,
                    taskSessionId: currentExecution.mainSessionId,
                  },
                ]
              : []),
          ],
        }
      : {};
  const task = await db.task.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      artifacts: {
        orderBy: { createdAt: "desc" },
        ...(currentExecution.planOutput?.finalizedResult ? {} : { take: 5 }),
      },
      timelineItems: {
        where:
          selectedWorkBlockId !== null
            ? { workBlockId: selectedWorkBlockId }
            : {},
        orderBy: [{ sortTime: "desc" }, { createdAt: "desc" }],
        take: 100,
      },
      events: {
        where: scopedEventWhere,
        orderBy: { ingestSequence: "desc" },
        take: 300,
      },
    },
  });
  if (!task) {
    throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found");
  }
  const artifacts = await Promise.all(
    task.artifacts.map(
      async (artifact: {
        id: string;
        title: string;
        type: string;
        uri: string;
      }) => ({
        id: artifact.id,
        title: artifact.title,
        type: artifact.type,
        uri: artifact.uri,
        ...(await resolveFilePreview(artifact.uri, { taskId: input.taskId })),
      }),
    ),
  );
  const activityTimeline = orderActivityNewestFirst(
    deduplicateProjectedActivity(
      task.timelineItems.length > 0
        ? [
            ...task.timelineItems.map(mapTimelineItemToActivity),
            ...buildActivityTimeline([...task.events].reverse()),
          ]
        : buildActivityTimeline([...task.events].reverse()),
    ),
  ).slice(0, 100);

  return {
    documents: {
      now: buildCommandCenterNowSpec({
        title: nowTitle(currentExecution.status),
        description: currentExecution.message,
        statusLabel: currentExecution.status,
        tone: nowTone(currentExecution.status),
        currentOperationSpec: currentExecution.ui?.currentOperationSpec ?? null,
      }),
      output: await hydrateFilePreviewSpec(
        currentExecution.planOutput?.finalizedResult?.spec
          ? materializeResultArtifactRefs(
              currentExecution.planOutput.finalizedResult.spec as UiDocument,
              task.artifacts,
            )
          : buildCommandCenterArtifactsSpec({ artifacts }),
        { taskId: input.taskId },
      ),
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
