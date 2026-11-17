import type { Prisma } from "@chrona/db";
import { exactReleaseBaselineSchema, type ExactReleaseBaseline } from "./module-install-types";
import { StewardError } from "../errors";
import type { ModuleContext, BuildReport } from "./module-context";
import { assertExternalModule, assertModuleOperation } from "./module-identity";
import { getModuleLocalHead, moduleGitPath, moduleGitRevision } from "./module-git";
import { verifyModuleGitBundle } from "./module-git-upstream";
import type { ModuleRelease } from "./module-release";
import { versionSource } from "./module-source";

export class ExactReleaseUpdateError extends StewardError {
  constructor(message: string) { super("conflict", message); }
}
/** The old approval is an equality precondition, never approval of another source tree. */
type ActiveModule = { id: string; activeHash: string | null; status: string; activationId: string | null };
export async function readExactReleaseBaselineIn(db: Prisma.TransactionClient, module: ActiveModule): Promise<ExactReleaseBaseline> {
  if (!module.activeHash || module.status === "migrating") throw new ExactReleaseUpdateError("Exact release update requires a current approved Git source");
  const active = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } });
  if (!active || active.status !== "approved" || !/^[a-f0-9]{40}$/.test(active.hash)) throw new ExactReleaseUpdateError("Active module version is not approved");
  return { activeHash: active.hash, versionId: active.id, activationId: module.activationId };
}
export async function prepareExactReleaseUpdate(context: ModuleContext, moduleId: string, release: ModuleRelease, baseline: ExactReleaseBaseline) {
  await assertExactReleaseUpdateIn(context, context.db, moduleId, { exactReleaseUpdate: baseline });
  if (!release.git) throw new ExactReleaseUpdateError("Exact release update requires a pinned Git release");
  const active = await context.db.moduleVersion.findUniqueOrThrow({ where: { id: baseline.versionId } });
  const source = await versionSource(context, active), location = { platform: context.platform, moduleId };
  const current = await moduleGitRevision(moduleGitPath(context.platform, moduleId), source.revision.commit);
  const selected = await verifyModuleGitBundle(release.git);
  if (current.tree !== selected.tree) throw new ExactReleaseUpdateError("Active source differs from the exact release; preserve local changes with a normal update");
  const expectedLocal = await getModuleLocalHead(location);
  if (!expectedLocal || (await moduleGitRevision(moduleGitPath(context.platform, moduleId), expectedLocal)).tree !== current.tree) throw new ExactReleaseUpdateError("Unselected local source exists; inspect it before selecting an exact release");
  await assertExactReleaseUpdateIn(context, context.db, moduleId, { exactReleaseUpdate: baseline });
  return { baseline, expectedLocal };
}
/** Read again in the queue/activation transaction: async checks cannot carry an old approval forward. */
export async function assertExactReleaseUpdateIn(
  context: ModuleContext, db: Prisma.TransactionClient, moduleId: string, report: Pick<BuildReport, "exactReleaseUpdate">,
  current?: Awaited<ReturnType<typeof assertExternalModule>> | null,
) {
  if (!report.exactReleaseUpdate) return;
  const baseline = exactReleaseBaselineSchema.parse(report.exactReleaseUpdate);
  const module = current ?? await assertExternalModule(db, context.workspaceId, moduleId, "update");
  if (current) assertModuleOperation(current, "update");
  const active = await db.moduleVersion.findUnique({ where: { id: baseline.versionId } });
  if (module.status === "migrating" || module.activeHash !== baseline.activeHash || module.activationId !== baseline.activationId || active?.moduleId !== moduleId || active.hash !== baseline.activeHash || active.status !== "approved") {
    throw new ExactReleaseUpdateError("Approved active identity changed during exact release update; inspect and submit a new request");
  }
}
/** A reused candidate keeps its original exact baseline; an old approval cannot authorize a new update. */
export function assertExactReleaseCandidate(existing: { hash: string; status: string; report: unknown } | null, baseline?: ExactReleaseBaseline) {
  if (!baseline || !existing || existing.status === "rejected" || existing.hash === baseline.activeHash) return;
  if (JSON.stringify((existing.report as BuildReport).exactReleaseUpdate) !== JSON.stringify(baseline)) {
    throw new ExactReleaseUpdateError("Selected release already has a candidate bound to another request; inspect it first");
  }
}
