import { db, type Prisma } from "@chrona/db";
import { aiArtifactRef } from "../plan-execution/use-cases/register-generated-plan-output-artifacts";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Plan results declare node-Run artifacts through their manifest, not through
 * the synthetic plan Run's runId. Never include undeclared history or a foreign
 * task/occurrence/work-block simply because an AF ref was supplied. */
export async function managementResultArtifacts(input: {
  workspaceId: string;
  taskId: string;
  run: { id: string; workBlockId: string | null; occurrenceId: string | null; runtimeRunRef: string | null };
  output: Record<string, unknown>;
  page: number;
  pageSize: number;
}) {
  const where: Prisma.ArtifactWhereInput = {
    workspaceId: input.workspaceId, taskId: input.taskId, occurrenceId: input.run.occurrenceId,
    run: { taskId: input.taskId, workBlockId: input.run.workBlockId, occurrenceId: input.run.occurrenceId },
  };
  const select = { id: true, title: true, type: true } as const;
  const skip = (input.page - 1) * input.pageSize;
  if (!input.run.runtimeRunRef?.startsWith("chrona-plan:")) {
    where.runId = input.run.id;
    const [artifacts, count] = await Promise.all([
      db.artifact.findMany({ where, select, skip, take: input.pageSize, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      db.artifact.count({ where }),
    ]);
    return { artifacts, count };
  }
  const manifest = object(input.output.manifest);
  const deliverables = Array.isArray(manifest.deliverables) ? manifest.deliverables.map(object).filter((item) => item.status === "current") : [];
  const evidence = Array.isArray(manifest.evidence) ? manifest.evidence.map(object) : [];
  const refs = new Set([...deliverables, ...evidence].flatMap((item) => typeof item.artifactRef === "string" && /^AF[0-9A-F]{12}$/.test(item.artifactRef) ? [item.artifactRef] : []));
  const ids: string[] = [];
  // AF is a hash of the database ID. Resolve in bounded ID-only batches; do not
  // load artifact contents or paginate before filtering declared refs.
  let cursor: string | undefined;
  while (refs.size > 0) {
    const rows = await db.artifact.findMany({ where, select: { id: true }, take: 200,
      orderBy: { id: "asc" }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    for (const row of rows) if (refs.has(aiArtifactRef(row.id))) ids.push(row.id);
    if (rows.length < 200) break;
    cursor = rows.at(-1)!.id;
  }
  const artifacts = ids.length ? await db.artifact.findMany({ where: { ...where, id: { in: ids } }, select,
    skip, take: input.pageSize, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }) : [];
  return { artifacts, count: ids.length };
}
