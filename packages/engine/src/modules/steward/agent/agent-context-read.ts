import { providerInteractionSchema } from "@chrona/contracts/steward";
import { providerRequestStatus, providerRunActive } from "@chrona/domain/steward/provider";
import type { StewardPorts } from "../ports";
import { hasLiveProviderInteraction } from "./provider-channel";
import { liveRuns } from "../execution/runs";
import { z } from "zod";
import { readRunContent } from "../execution/run-content";

export async function contextRunImages(ports: StewardPorts, run: { id: string; workspaceId: string }) {
  const receipt = await ports.db.agentRunAdmission.findUniqueOrThrow({ where: { runId: run.id } });
  const { content } = z.object({ content: z.array(z.string().max(1000)).max(10).default([]) }).parse(receipt);
  const images: { mime: string; base64: string }[] = []; let bytes = 0;
  for (const ref of content) {
    const file = await readRunContent(ports, run.workspaceId, receipt.moduleId, ref); bytes += file.bytes.byteLength;
    if (bytes > 20 * 1024 * 1024) throw new Error("Agent content exceeds 20 MiB");
    if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.mime)) images.push({ mime: file.mime, base64: Buffer.from(file.bytes).toString("base64") });
  }
  return images;
}

/** Caller has already proved ownership of this exact Run. No workspace-wide discovery. */
export async function contextInteractions(ports: StewardPorts, run: { id: string; workspaceId: string; status: string; deadlineAt: Date | null; leaseUntil: Date | null; cancelRequestedAt: Date | null }) {
  const { workspaceId } = run;
  const requested = await ports.db.runInteraction.findMany({ where: { runId: run.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 12 });
  const alive = providerRunActive(run, liveRuns.has(run.id) && !run.cancelRequestedAt, ports.now());
  return requested.map(row => {
    const question = providerInteractionSchema.parse(row.request);
    return { ...question, status: providerRequestStatus(question, row.status === "pending" ? undefined : row.status as typeof question.status, alive, hasLiveProviderInteraction(ports, workspaceId, run.id, question.id), ports.now()) };
  });
}
