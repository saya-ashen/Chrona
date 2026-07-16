import { basename } from "node:path";
import { db } from "@/lib/db";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import {
  resolveGeneratedFileReference,
  requestResultFileAccess,
} from "./result-file-access";

function outputSpecFromPlanRun(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const graph = record.mutableGraph;
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return null;
  const planOutput = (graph as Record<string, unknown>).planOutput;
  if (!planOutput || typeof planOutput !== "object" || Array.isArray(planOutput))
    return null;
  const spec = (planOutput as Record<string, unknown>).spec;
  return spec && typeof spec === "object" && !Array.isArray(spec)
    ? (spec as { elements?: Record<string, { type?: unknown; props?: unknown }> })
    : null;
}

function specReferencesFile(value: unknown, requestedPath: string) {
  const spec = outputSpecFromPlanRun(value);
  return Object.values(spec?.elements ?? {}).some((element) => {
    if (element.type !== "FileRef" && element.type !== "FileView") return false;
    if (!element.props || typeof element.props !== "object" || Array.isArray(element.props))
      return false;
    const props = element.props as Record<string, unknown>;
    return props.path === requestedPath || props.uri === requestedPath;
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

  const planRuns = await db.taskPlanRun.findMany({
    where: { taskId: input.taskId },
    select: { planRun: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!planRuns.some((run) => specReferencesFile(run.planRun, input.requestedPath))) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "This file is not referenced by the task result",
    );
  }

  const access = await requestResultFileAccess(input);
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
