import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { currentModuleEvolution } from "./module-evolution";

const kind = "module_execution_result";
const resultSchema = z.object({
  moduleId: z.string(), hash: z.string(), activationId: z.string(), resultId: z.string(),
  outcome: z.enum(["success", "failure"]), consecutiveFailures: z.number().int().nonnegative(),
});
type Db = Prisma.TransactionClient;
type Activation = { workspaceId: string; moduleId: string; hash: string; activationId: string | null };
const decision = (consecutiveFailures: number) => ({ consecutiveFailures, shouldPause: consecutiveFailures >= 3 });

/** Durable execution policy, not an incident total or a count of ModuleRun.error rows.
 * Audit subjects are activation IDs: reactivating identical code cannot inherit a streak.
 * Unattributed executions cannot be assigned to a historical activation.
 */
export async function moduleFailurePolicy(db: Db, input: Activation) {
  if (!input.activationId || (await currentModuleEvolution(db, input.workspaceId, input.moduleId, input.hash))?.activationId !== input.activationId) return null;
  const row = await db.audit.findFirst({ where: { workspaceId: input.workspaceId, subjectId: input.activationId, kind }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const previous = resultSchema.safeParse(row?.details);
  return { ...decision(previous.success ? previous.data.consecutiveFailures : 0), createdAt: row?.createdAt };
}

/** Call within the execution-result transaction. A stable run ID makes observation idempotent.
 * Output-contract mismatches never enter this policy (neither failure nor recovery).
 */
export async function recordModuleExecution(db: Db, input: Activation & { resultId: string; outcome: "success" | "failure"; now: Date }) {
  const previous = await moduleFailurePolicy(db, input);
  if (!previous || !input.activationId) return null;
  const id = `module-execution:${input.activationId}:${input.resultId}`;
  if (await db.audit.findUnique({ where: { id }, select: { id: true } })) return { ...previous, duplicate: true };
  const state = decision(input.outcome === "success" ? 0 : previous.consecutiveFailures + 1);
  await db.audit.create({ data: { id, workspaceId: input.workspaceId, subjectId: input.activationId, actorKey: "chrona", kind,
    createdAt: new Date(Math.max(input.now.getTime(), (previous.createdAt?.getTime() ?? -Infinity) + 1)),
    details: { moduleId: input.moduleId, hash: input.hash, activationId: input.activationId, resultId: input.resultId, outcome: input.outcome, consecutiveFailures: state.consecutiveFailures },
  } });
  return { ...state, duplicate: false };
}
