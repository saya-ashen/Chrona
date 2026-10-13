import { proposeDelegationSchema, delegationTransitionSchema, notificationPolicySchema } from "@chrona/contracts/steward";
import { nextDelegationStatus } from "@chrona/domain/steward/permission";
import { audit, delegationView, requireAffair, StewardError, type Context } from "./mappers";
import { connection } from "./connections";
export async function proposeDelegation(ctx: Context, raw: unknown) {
  const input = proposeDelegationSchema.parse(raw);
  if (input.affairId) await requireAffair(ctx, input.affairId);
  if (input.connectionId) await connection(ctx, input.connectionId);
  return delegationView(await ctx.db.delegation.create({ data: { ...input, notification: input.notification ?? notificationPolicySchema.parse({}), workspaceId: ctx.actor.workspaceId, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, status: "proposed", revision: 1 } }));
}
export async function transitionDelegation(ctx: Context, id: string, raw: unknown) {
  const input = delegationTransitionSchema.parse(raw);
  return ctx.db.$transaction(async tx => {
    const row = await tx.delegation.findFirst({ where: { id, workspaceId: ctx.actor.workspaceId } });
    if (!row) throw new StewardError("NOT_FOUND", "Delegation not found");
    if (row.revision !== input.expectedRevision) throw new StewardError("REVISION_CONFLICT", "Delegation revision changed");
    const status = nextDelegationStatus(delegationView(row).status, input.action);
    const changed = await tx.delegation.updateMany({ where: { id, revision: input.expectedRevision }, data: { status, revision: { increment: 1 }, ...(input.action === "grant" ? { grantedAt: ctx.now() } : {}) } });
    if (!changed.count) throw new StewardError("REVISION_CONFLICT", "Delegation revision changed");
    await audit(tx, ctx, "delegation_transition", id, { ...input, status, revision: input.expectedRevision + 1 });
    return delegationView(await tx.delegation.findUniqueOrThrow({ where: { id } }));
  });
}
