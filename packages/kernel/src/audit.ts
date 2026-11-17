import type { Prisma } from "@chrona/db";
export function audit(tx: Prisma.TransactionClient, input: { workspaceId: string; kind: string; actor: string; subjectId?: string | null; details: Prisma.InputJsonValue }) {
  const { actor, ...data } = input;
  return tx.audit.create({ data: { ...data, actorKey: actor } });
}
