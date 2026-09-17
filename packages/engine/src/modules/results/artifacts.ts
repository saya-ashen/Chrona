import { db, type Artifact } from "@chrona/db";
import type { WorkResultContent } from "@chrona/contracts/results";
import { aiArtifactRef } from "./artifact-ref";
import { contentArtifactRefs, requireResultPermission, WorkResultError, type ResultPrincipal, type ResultScope, type TaskResultsPorts } from "./access";

import { resultPayloadHash } from "./content-hash";

type Binding = { artifactId: string; artifactRef: string; artifactFingerprint: string; key: string; role: "deliverable" | "evidence"; required: boolean };
const snapshotSelect = { id: true, workspaceId: true, taskId: true, occurrenceId: true, runId: true, uri: true, metadata: true, type: true } as const;
function artifactFingerprint(a: Pick<Artifact, keyof typeof snapshotSelect>) {
  return resultPayloadHash({ id: a.id, workspaceId: a.workspaceId, taskId: a.taskId, occurrenceId: a.occurrenceId, runId: a.runId, uri: a.uri, metadata: a.metadata, type: a.type });
}

export async function resolveResultArtifacts(ports: TaskResultsPorts, principal: ResultPrincipal, scope: ResultScope, content: WorkResultContent): Promise<Binding[]> {
  const refs = contentArtifactRefs(content);
  if (!refs.length) return [];
  requireResultPermission(principal, "artifacts:read");
  const ids = await scopedArtifactIds(principal.workspaceId, scope, new Set(refs));
  for (const ref of refs) {
    const id = ids.get(ref);
    if (!id) throw new WorkResultError("NOT_FOUND", "Declared result artifact not found in this scope");
    if (await ports.artifactAvailable?.(id, { ...scope, workspaceId: principal.workspaceId }) !== true) {
      throw new WorkResultError("PRECONDITION_FAILED", "Result artifact bytes are not available or not verified");
    }
  }
  const rows = await db.artifact.findMany({ where: { id: { in: [...ids.values()] } }, select: snapshotSelect });
  const fingerprints = new Map(rows.map((row) => [row.id, artifactFingerprint(row)]));
  const identity = (ref: string) => ({ artifactId: ids.get(ref)!, artifactRef: ref, artifactFingerprint: fingerprints.get(ids.get(ref)!)! });
  return [
    ...content.deliverables.map((item) => ({ ...identity(item.artifactRef), key: item.key, role: "deliverable" as const, required: item.required })),
    ...content.evidence.flatMap((item) => item.artifactRef ? [{ ...identity(item.artifactRef), key: item.key, role: "evidence" as const, required: true }] : []),
  ];
}

async function scopedArtifactIds(workspaceId: string, scope: ResultScope, refs: Set<string>) {
  const ids = new Map<string, string>();
  // Existing AF references hash IDs. Bounded ID-only scan; detect ambiguity, never pick a collision.
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const rows = await db.artifact.findMany({ where: { workspaceId, taskId: scope.taskId, occurrenceId: scope.occurrenceId,
      run: { taskId: scope.taskId, occurrenceId: scope.occurrenceId, ...(scope.occurrenceId === null ? { workBlockId: null } : {}) } },
      select: { id: true }, orderBy: { id: "asc" }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    for (const row of rows) {
      const ref = aiArtifactRef(row.id);
      if (!refs.has(ref)) continue;
      if (ids.has(ref)) throw new WorkResultError("PRECONDITION_FAILED", "Ambiguous result artifact reference");
      ids.set(ref, row.id);
    }
    if (rows.length < 200) return ids;
    cursor = rows.at(-1)!.id;
  }
  throw new WorkResultError("PRECONDITION_FAILED", "Artifact lookup limit reached; no result was changed");
}

function artifactMatchesVersion(a: Pick<Artifact, keyof typeof snapshotSelect> & { run: { taskId: string; occurrenceId: string | null; workBlockId: string | null } }, fingerprint: string, principal: ResultPrincipal, scope: ResultScope) {
  return artifactFingerprint(a) === fingerprint && a.workspaceId === principal.workspaceId && a.taskId === scope.taskId && a.occurrenceId === scope.occurrenceId &&
    a.run.taskId === scope.taskId && a.run.occurrenceId === scope.occurrenceId && (scope.occurrenceId !== null || a.run.workBlockId === null);
}

export async function unavailableVersionArtifacts(ports: TaskResultsPorts, principal: ResultPrincipal, scope: ResultScope, versionId: string) {
  const links = await db.resultVersionArtifact.findMany({ where: { versionId, required: true }, take: 121,
    include: { artifact: { select: { ...snapshotSelect, run: { select: { taskId: true, occurrenceId: true, workBlockId: true } } } } } });
  if (links.length > 120) throw new WorkResultError("PRECONDITION_FAILED", "Result artifact bindings exceed the supported limit");
  const missing = new Set<string>();
  const verified = new Map<string, boolean>();
  for (const link of links) {
    const matches = artifactMatchesVersion(link.artifact, link.artifactFingerprint, principal, scope);
    if (!matches || !principal.permissions.includes("artifacts:read")) { missing.add(link.artifactRef); continue; }
    if (!verified.has(link.artifactId)) verified.set(link.artifactId, await ports.artifactAvailable?.(link.artifactId, { ...scope, workspaceId: principal.workspaceId }) === true);
    if (!verified.get(link.artifactId)) missing.add(link.artifactRef);
  }
  return [...missing];
}
