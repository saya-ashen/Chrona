import { createHash } from "node:crypto";
import { workToolInputSchemas } from "@chrona/contracts/steward";
import { workResultContentSchema } from "@chrona/contracts/results";
import { publishWorkResult } from "../results/publish";
import { createTask } from "../tasks/create-task";
import type { WorkToolContext } from "./work-context";
/** Called only inside the work envelope's transaction-aware database scope. */
export async function publishAgentResult({ tx, work, attempt, workspaceId }: WorkToolContext, raw: unknown) {
  const input = workToolInputSchemas.chrona_publish_result.parse(raw);
  const observed = new Set((Array.isArray(attempt.observedSources) ? attempt.observedSources : []).map(s => (s as { url?: string })?.url));
  const ready = !input.limitations.trim() && input.sources.every(s => observed.has(s.url));
  const findings = []; for (let i = 0; i < input.body.length; i += 8000) findings.push({ key: `body-${i / 8000}`, content: input.body.slice(i, i + 8000) });
  const content = workResultContentSchema.parse({ schemaVersion: 1, outcome: { title: input.title, summary: input.summary }, readiness: { status: ready ? "ready" : "ready_with_caveats", summary: ready ? "成果已整理。" : "请留意限制与未核实来源。" }, findings,
    caveats: input.limitations ? [{ key: "limitations", content: input.limitations }] : [], nextActions: input.nextSteps.map((content, i) => ({ key: `next-${i}`, content })),
    evidence: input.sources.map((s, i) => ({ key: `source-${i}`, summary: `${observed.has(s.url) ? "本次检索取得" : "未在本次检索中核实"}：${s.title}\n${s.url}` })) });
  const affair = await tx.affair.findFirstOrThrow({ where: { id: work.affairId, workspaceId } });
  let taskId = affair.taskId;
  if (!taskId) {
    const task = await createTask({ workspaceId, title: input.title, description: work.request, taskExecutionMode: "manual", autoPlanGeneration: false, autoExecute: false }, tx);
    taskId = task.taskId; await tx.affair.update({ where: { id: affair.id, workspaceId }, data: { taskId } });
  }
  const result = await tx.taskResult.findFirst({ where: { workspaceId, taskId, occurrenceId: null } });
  const hex = createHash("sha256").update(`steward-result:${attempt.id}`).digest("hex");
  const requestId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  // Reuse the original revision on replay, not the new head's revision.
  const command = await tx.resultCommand.findFirst({ where: { workspaceId, actorKey: "external:steward-agent", requestId } });
  const previousRevision = command ? Number((command.receipt as { editRevision: string }).editRevision.split(":").at(-1)) - 1 : null;
  const expectedRevision = command ? (previousRevision === 0 ? null : `result-v1:${command.resultId}:${previousRevision}`) : result ? `result-v1:${result.id}:${result.editRevision}` : null;
  const published = await publishWorkResult({ authorize: async scope => scope.taskId === taskId && scope.occurrenceId === null ? { workspaceId, actorKind: "external", actorId: "steward-agent", permissions: ["results:read", "results:write"] } : null }, { taskId, occurrenceId: null, requestId, expectedRevision, content, source: { label: "Chrona steward", workId: work.id } });
  return { taskId, versionId: published.receipt.versionId, handling: input.handling, summary: input.summary };
}
