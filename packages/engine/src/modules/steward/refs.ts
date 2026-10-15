import type { Prisma } from "@chrona/db/generated/prisma/client";
import { generateReplyRef } from "@chrona/domain/steward/chat";
import { StewardError } from "./mappers";
type Tx = Prisma.TransactionClient;
/** First write serializes allocation across both tables under SQLite's writer lock. */
export async function ensureRef(tx: Tx, table: "attentionItem" | "delegation", id: string): Promise<string> {
  const assign = (replyRef: string | null) => table === "attentionItem" ? tx.attentionItem.updateMany({ where: { id, replyRef: null }, data: { replyRef } }) : tx.delegation.updateMany({ where: { id, replyRef: null }, data: { replyRef } });
  await assign(null);
  const query = { where: { id }, select: { workspaceId: true, replyRef: true } } as const;
  const row = table === "attentionItem" ? await tx.attentionItem.findFirstOrThrow(query) : await tx.delegation.findFirstOrThrow(query);
  if (row.replyRef) return row.replyRef;
  for (let attempt = 0; attempt < 20; attempt++) {
    const replyRef = generateReplyRef(), where = { workspaceId: row.workspaceId, replyRef };
    if (await tx.attentionItem.count({ where }) || await tx.delegation.count({ where })) continue;
    try { await assign(replyRef); return replyRef; }
    catch (error) { if ((error as { code?: string }).code !== "P2002") throw error; }
  }
  throw new StewardError("REVISION_CONFLICT", "Could not allocate a reply ref");
}
/** Shared proposal effect; callers supply authenticated scope and verified source/binding. Never grants authority. */
export async function createDelegationProposal(tx: Tx, input: Pick<Prisma.DelegationUncheckedCreateInput, "workspaceId" | "affairId" | "connectionId" | "purpose" | "originalWording" | "cadenceSeconds" | "allowedActions" | "notification" | "limits">, whyItMatters: string, evidence: Prisma.InputJsonValue, now: Date) {
  const delegation = await tx.delegation.create({ data: { ...input, status: "proposed", revision: 1, askFirstActions: [], createdAt: now } });
  const ref = await ensureRef(tx, "delegation", delegation.id), nextStep = `回复「/chrona ${ref} 确认」生效，或「/chrona ${ref} 取消」。`;
  const item = await tx.attentionItem.create({ data: { workspaceId: input.workspaceId, affairId: input.affairId, delegationId: delegation.id, delegationRevision: 1, dedupeKey: `delegation-proposal:${delegation.id}:r1`, kind: "decision", title: `确认委托：${input.purpose}`.slice(0, 200), whatHappened: input.purpose, whyItMatters, nextStep, evidence, createdAt: now } });
  return { delegation, item, ref, nextStep };
}
