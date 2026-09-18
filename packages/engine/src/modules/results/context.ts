import { db } from "@chrona/db";
import type { WorkResultContext } from "@chrona/contracts/results";
import { workResultWritesAllowed } from "@chrona/domain/task/work-results";
import { authorizeResult, type ResultScope, type TaskResultsPorts } from "./access";
import { resultWritesEnabled } from "./entry-policy";
import { contentHasPage, pageWritesEnabled } from "./page-policy";
import { findWorkResult } from "./commands";

export async function resultContext(ports: TaskResultsPorts, scope: ResultScope): Promise<WorkResultContext> {
  const principal = await authorizeResult(ports, scope, "results:read");
  const task = await db.task.findUniqueOrThrow({ where: { id: scope.taskId }, select: { id: true, title: true, status: true, definitionStatus: true, workspace: { select: { status: true } } } });
  const workOpen = workResultWritesAllowed(task, task.workspace.status);
  const writesEnabled = resultWritesEnabled();
  const writable = writesEnabled && workOpen;
  const result = await findWorkResult(principal, scope);
  const head = result?.headVersionId ? await db.taskResultVersion.findUnique({ where: { id: result.headVersionId }, select: { content: true } }) : null;
  const hasPage = contentHasPage(head?.content);
  const pageReadable = principal.permissions.includes("pages:read");
  const pageWritable = pageReadable && principal.permissions.includes("pages:write") && pageWritesEnabled();
  return { task: { id: task.id, title: task.title, status: task.status, definitionStatus: task.definitionStatus }, occurrenceId: scope.occurrenceId,
    writesEnabled, workOpen, canSubmit: writable && principal.permissions.includes("results:write") && (!hasPage || pageWritable), canReview: writable && principal.permissions.includes("results:review") && (!hasPage || pageReadable),
    canUpload: writable && principal.permissions.includes("artifacts:write"), canDownload: principal.permissions.includes("artifacts:read") };
}
