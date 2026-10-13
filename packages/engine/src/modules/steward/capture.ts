import type { Prisma } from "@chrona/db";
import type { ManagementStewardCapture } from "@chrona/contracts/api";
import { StewardError } from "./mappers";

const normalize = (title: string) => title.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
/** Caller owns the transaction and durable request receipt. No notification or authority writes. */
export async function captureSteward(tx: Prisma.TransactionClient, workspaceId: string, actorKey: string, clientName: string, input: ManagementStewardCapture) {
  if (input.affairId && !await tx.affair.findFirst({ where: { id: input.affairId, workspaceId }, select: { id: true } })) throw new StewardError("NOT_FOUND", "Affair not found");
  const candidates = input.newAffair ? await tx.affair.findMany({ where: { workspaceId }, select: { id: true, title: true, status: true } }) : [];
  const possibleDuplicates = candidates.filter(row => normalize(row.title) === normalize(input.newAffair!.title)).slice(0, 20);
  if (input.dryRun) return { dryRun: true, possibleDuplicates, permissionsGranted: false, notificationsSent: false };
  const affairId = input.newAffair ? (await tx.affair.create({ data: { ...input.newAffair, workspaceId } })).id : input.affairId ?? null;
  const attention = await tx.attentionItem.create({ data: {
    workspaceId, affairId, kind: "commitment", dedupeKey: `capture:${input.requestId}`,
    title: input.note.slice(0, 200), whatHappened: input.note,
    whyItMatters: `captured by ${clientName}`, nextStep: "Review this captured commitment in Today or Affairs.",
    evidence: [input.source], dueAt: input.followUp ? new Date(input.followUp.dueAt) : null,
  } });
  const followUp = input.followUp ? await tx.followUp.create({ data: { workspaceId, affairId, attentionItemId: attention.id, note: input.followUp.note, dueAt: new Date(input.followUp.dueAt) } }) : null;
  await tx.stewardAudit.create({ data: { workspaceId, actorKey, kind: "management_capture", subjectId: attention.id, details: { requestId: input.requestId, provenance: `captured by ${clientName}`, source: input.source } } });
  return { affairId, attentionItemId: attention.id, followUpId: followUp?.id ?? null, possibleDuplicates, permissionsGranted: false, notificationsSent: false };
}
