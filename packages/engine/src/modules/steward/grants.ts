import type { Prisma } from "@chrona/db";
import { createGrantSchema, DEFAULT_POLICY, type Action } from "@chrona/contracts/steward";
import { decidePolicy } from "@chrona/domain/steward/policy";
import { type RecordContext, requireAffair } from "./affairs";
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
import { toGrant } from "./store";
export async function consumeOnce(tx: Prisma.TransactionClient, grantId: string, at = new Date()) {
  const row = await tx.grant.findUnique({ where: { id: grantId } });
  if (!row) throw new StewardError("not_found", "Grant not found");
  if (!row.once) return;
  const result = await tx.grant.updateMany({ where: { id: grantId, consumedAt: null, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: at } }] }, data: { consumedAt: at, revision: { increment: 1 } } });
  if (!result.count) throw new StewardError("conflict", "Grant no longer active");
  await audit(tx, { workspaceId: row.workspaceId, kind: "grant_consumed", actor: "chrona", subjectId: grantId, details: {} });
}
export async function effectivePolicyIn(db: Prisma.TransactionClient, workspaceId: string, action: Action, target: Parameters<typeof decidePolicy>[1], now: Date) {
  if (target.affairId) await requireAffair(db, workspaceId, target.affairId);
  if (target.connectionId && !await db.sourceConnection.findFirst({ where: { workspaceId, id: target.connectionId } })) throw new StewardError("not_found", "Connection not found");
  if (target.toolId && !await db.managedTool.findFirst({ where: { workspaceId, id: target.toolId } })) throw new StewardError("not_found", "Tool not found");
  return decidePolicy(action, target, (await db.grant.findMany({ where: { workspaceId, action } })).map(toGrant), now);
}
export function createGrants({ db, workspaceId, now }: RecordContext) {
  return {
    list: async () => {
      const rows = (await db.grant.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } })).map(toGrant);
      const active = (g: typeof rows[number]) => !g.revokedAt && !(g.once && g.consumedAt) && (!g.expiresAt || Date.parse(g.expiresAt) > now().getTime());
      return rows.sort((a, b) => Number(active(b)) - Number(active(a)));
    },
    create: (raw: unknown) => db.$transaction(async tx => {
      const input = parseInput(createGrantSchema, raw), scope = input.scope;
      if (DEFAULT_POLICY[input.action] === "never" && input.mode !== "never") throw new StewardError("forbidden", "Built-in never cannot be loosened");
      if (scope.kind === "affair") await requireAffair(tx, workspaceId, scope.affairId);
      if (scope.kind === "connection" && !await tx.sourceConnection.findFirst({ where: { workspaceId, id: scope.connectionId } })) throw new StewardError("not_found", "Connection not found");
      if (scope.kind === "tool_version" && !await tx.toolVersion.findFirst({ where: { workspaceId, toolId: scope.toolId, version: scope.version } })) throw new StewardError("not_found", "Tool version not found");
      const row = await tx.grant.create({ data: { ...input, workspaceId, origin: "user", createdAt: now(), expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } });
      await audit(tx, { workspaceId, kind: "grant_created", actor: "user", subjectId: row.id, details: input });
      return toGrant(row);
    }),
    revoke: (id: string) => db.$transaction(async tx => {
      if (!await tx.grant.findFirst({ where: { workspaceId, id } })) throw new StewardError("not_found", "Grant not found");
      const row = await tx.grant.update({ where: { id }, data: { revokedAt: now(), revision: { increment: 1 } } });
      await audit(tx, { workspaceId, kind: "grant_revoked", actor: "user", subjectId: id, details: {} });
      return toGrant(row);
    }),
    effectivePolicy: (action: Action, target: Parameters<typeof decidePolicy>[1]) => effectivePolicyIn(db, workspaceId, action, target, now()),
  };
}
