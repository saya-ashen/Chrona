import type { Prisma } from "@chrona/db";
import { createGrantSchema, DEFAULT_POLICY, type Action } from "@chrona/contracts/steward";
import { decidePolicy } from "@chrona/domain/steward/policy";
import { type RecordContext, requireAffair } from "./affairs";
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
import { toGrant } from "./store";
export async function consumeOnce(tx: Prisma.TransactionClient, workspaceId: string, grantId: string, at = new Date()) {
  const row = await tx.grant.findFirst({ where: { id: grantId, workspaceId } });
  if (!row) throw new StewardError("not_found", "Grant not found");
  if (row.revokedAt || (row.expiresAt && row.expiresAt <= at)) throw new StewardError("conflict", "Grant no longer active");
  if (!row.once) return;
  const result = await tx.grant.updateMany({ where: { id: grantId, consumedAt: null, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: at } }] }, data: { consumedAt: at } });
  if (!result.count) throw new StewardError("conflict", "Grant no longer active");
  await audit(tx, { workspaceId: row.workspaceId, kind: "grant_consumed", actor: "chrona", subjectId: grantId, details: {} });
}
export async function effectivePolicyIn(db: Prisma.TransactionClient, workspaceId: string, action: Action, target: Parameters<typeof decidePolicy>[1], now: Date) {
  if (target.affairId) await requireAffair(db, workspaceId, target.affairId);
  if (target.connectorId && !await db.connector.findFirst({ where: { workspaceId, id: target.connectorId } })) throw new StewardError("not_found", "Connector not found");
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
      if (scope.kind === "connector" && !await tx.connector.findFirst({ where: { workspaceId, id: scope.connectorId } })) throw new StewardError("not_found", "Connector not found");
      const row = await tx.grant.create({ data: { ...input, workspaceId, createdAt: now(), expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } });
      await audit(tx, { workspaceId, kind: "grant_created", actor: "user", subjectId: row.id, details: input });
      return toGrant(row);
    }),
    revoke: (id: string) => db.$transaction(async tx => {
      if (!await tx.grant.findFirst({ where: { workspaceId, id } })) throw new StewardError("not_found", "Grant not found");
      const row = await tx.grant.update({ where: { id }, data: { revokedAt: now() } });
      await audit(tx, { workspaceId, kind: "grant_revoked", actor: "user", subjectId: id, details: {} });
      return toGrant(row);
    }),
    effectivePolicy: (action: Action, target: Parameters<typeof decidePolicy>[1]) => effectivePolicyIn(db, workspaceId, action, target, now()),
  };
}
/** Host paths the user approved for a run in this affair (or at the root); once grants are spent by the run that mounts them. */
export async function hostPathsFor(db: Prisma.TransactionClient, workspaceId: string, affairId: string | null, at: Date) {
  const rows = await db.approval.findMany({ where: { workspaceId, action: "access_host_path", status: "approved", grant: { revokedAt: null } }, include: { grant: true } });
  const paths: string[] = [];
  for (const row of rows) {
    const grant = row.grant, path = (row.payload as { path?: unknown }).path;
    if (!grant || typeof path !== "string" || (grant.expiresAt && grant.expiresAt <= at) || (grant.once && grant.consumedAt)) continue;
    const scope = grant.scope as { kind?: string; affairId?: string };
    if (scope.kind === "affair" && scope.affairId !== affairId) continue;
    if (grant.once) { try { await consumeOnce(db, workspaceId, grant.id, at); } catch { continue; } }
    paths.push(path);
  }
  return [...new Set(paths)];
}
