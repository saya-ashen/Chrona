import { basename } from "node:path";
import { db } from "@/lib/db";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import {
  resolveGeneratedFileReference,
  requestResultFileAccess,
} from "./result-file-access";
import { aiArtifactRef } from "../plan-execution/use-cases/register-generated-plan-output-artifacts";

function outputSpecFromPlanRun(value: unknown): {
  elements?: Record<string, { type?: unknown; props?: unknown }>;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const nestedPlanRun = record.planRun;
  if (nestedPlanRun && typeof nestedPlanRun === "object" && !Array.isArray(nestedPlanRun)) {
    const nestedSpec = outputSpecFromPlanRun(nestedPlanRun);
    if (nestedSpec) return nestedSpec;
  }
  const graph = record.mutableGraph;
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return null;
  const planOutput = (graph as Record<string, unknown>).planOutput;
  if (!planOutput || typeof planOutput !== "object" || Array.isArray(planOutput))
    return null;
  const finalizedResult = (planOutput as Record<string, unknown>).finalizedResult;
  if (!finalizedResult || typeof finalizedResult !== "object" || Array.isArray(finalizedResult)) {
    return null;
  }
  const spec = (finalizedResult as Record<string, unknown>).spec;
  return spec && typeof spec === "object" && !Array.isArray(spec)
    ? (spec as { elements?: Record<string, { type?: unknown; props?: unknown }> })
    : null;
}

function specReferencesFile(value: unknown, requestedIdentities: ReadonlySet<string>) {
  const spec = outputSpecFromPlanRun(value);
  return Object.values(spec?.elements ?? {}).some((element) => {
    if (
      element.type !== "FileRef" &&
      element.type !== "FileView" &&
      element.type !== "ResultDeliverable" &&
      element.type !== "WorkspaceArtifactItem" &&
      element.type !== "Table"
    ) return false;
    if (!element.props || typeof element.props !== "object" || Array.isArray(element.props))
      return false;
    const props = element.props as Record<string, unknown>;
    return [props.path, props.uri, props.artifactRef].some(
      (candidate) => typeof candidate === "string" && requestedIdentities.has(candidate),
    );
  });
}

export async function openTaskResultFile(input: {
  taskId: string;
  requestedPath: string;
}) {
  const generatedPath = resolveGeneratedFileReference(input.requestedPath);
  if (!generatedPath) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "Only generated task result files can be downloaded directly",
    );
  }

  const artifact = await db.artifact.findFirst({
    where: { taskId: input.taskId, uri: input.requestedPath, type: "file" },
    orderBy: { createdAt: "desc" },
    select: { id: true, runId: true },
  });
  if (!artifact) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "This file is not a registered task result Artifact",
    );
  }
  const planEvent = await db.event.findFirst({
    where: { taskId: input.taskId, runId: artifact.runId, planId: { not: null } },
    orderBy: { ingestSequence: "desc" },
    select: { planId: true },
  });
  const requestedIdentities = new Set([
    input.requestedPath,
    aiArtifactRef(artifact.id),
  ]);
  const planRuns = planEvent?.planId
    ? await db.taskPlanRun.findMany({
        where: { taskId: input.taskId, planId: planEvent.planId },
        select: { planRun: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      })
    : [];
  if (!planRuns.some((run) => specReferencesFile(run.planRun, requestedIdentities))) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "This file is not referenced by the task result",
    );
  }

  const access = await requestResultFileAccess({
    taskId: input.taskId,
    requestedPath: generatedPath,
  });
  if (access.status !== "already_allowed") {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "Generated task result file is not directly accessible",
    );
  }

  const file = Bun.file(access.canonicalPath);
  if (!(await file.exists())) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "File was not found",
    );
  }
  return {
    file,
    filename: basename(access.canonicalPath),
  };
}
