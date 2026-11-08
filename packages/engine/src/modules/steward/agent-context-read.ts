import { providerInteractionSchema } from "@chrona/contracts/steward";
import { providerRequestStatus, providerRunActive } from "@chrona/domain/steward/provider";
import type { StewardPorts } from "./ports";
import { hasLiveProviderInteraction } from "./provider-channel";
import { providerCancelKey } from "./provider-journal";
import { liveRuns } from "./runs";
import { z } from "zod";
import { readRunContent } from "./run-content";

export async function contextRunImages(ports: StewardPorts, run: { id: string; workspaceId: string }) {
  const receipt = await ports.db.audit.findUniqueOrThrow({ where: { id: `agent-tools:${run.id}` } });
  const { content } = z.object({ content: z.array(z.string().max(1000)).max(10).default([]) }).parse(receipt.details);
  const images: { mime: string; base64: string }[] = []; let bytes = 0;
  for (const ref of content) {
    const file = await readRunContent(ports, run.workspaceId, receipt.actorKey, ref); bytes += file.bytes.byteLength;
    if (bytes > 20 * 1024 * 1024) throw new Error("Agent content exceeds 20 MiB");
    if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.mime)) images.push({ mime: file.mime, base64: Buffer.from(file.bytes).toString("base64") });
  }
  return images;
}

/** Caller has already proved ownership of this exact Run. No workspace-wide discovery. */
export async function contextInteractions(ports: StewardPorts, run: { id: string; workspaceId: string; status: string; deadlineAt: Date | null; leaseUntil: Date | null }) {
  const { workspaceId } = run;
  const requested = await ports.db.audit.findMany({ where: { workspaceId, subjectId: run.id, kind: "provider_question" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 12 });
  const questions = requested.map(row => providerInteractionSchema.parse(row.details));
  const receipts = await ports.db.audit.findMany({ where: { workspaceId, kind: "provider_answer", subjectId: { in: questions.map(question => question.id) } } });
  const cancelling = await ports.db.audit.findUnique({ where: { id: providerCancelKey(run.id) } });
  const alive = providerRunActive(run, liveRuns.has(run.id) && !cancelling, ports.now());
  return questions.map(question => {
    const receipt = receipts.find(row => row.subjectId === question.id)?.details as { status?: typeof question.status } | undefined;
    return { ...question, status: providerRequestStatus(question, receipt?.status, alive, hasLiveProviderInteraction(ports, workspaceId, run.id, question.id), ports.now()) };
  });
}
