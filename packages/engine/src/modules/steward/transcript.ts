import { join } from "node:path";
import { runtimeTranscriptSchema, type ProviderTranscriptItem } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { callProviderEndpoint, providerSnapshot, runProviderBinding } from "./agent-provider";

export type TranscriptItem = ProviderTranscriptItem;
import { transcriptRedactor } from "@chrona/logging/redaction";
/** Backend file formats stay in the adapter; chat owns scoped access and sanitized, bounded output. */
export async function sessionTranscript(ports: StewardPorts, sessionId: string, limit = 300): Promise<TranscriptItem[]> {
  const count = Math.min(300, Math.max(1, Math.trunc(limit))), redact = transcriptRedactor();
  const session = await ports.db.session.findUniqueOrThrow({ where: { id: sessionId }, select: { workspaceId: true } });
  const run = await ports.db.run.findFirst({ where: { workspaceId: session.workspaceId, sessionId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, cwd: true } });
  if (!run) return [];
  const binding = await runProviderBinding(ports, session.workspaceId, run.id);
  if (!providerSnapshot(binding.declaration).endpoints.transcript) return [];
  const items = runtimeTranscriptSchema.parse(await callProviderEndpoint(ports, session.workspaceId, binding, "transcript", { sessionDir: join(run.cwd, ".chrona", "sessions"), limit: count }));
  return items.slice(-count).map(item => {
    if (item.kind === "tool") return { ...item, args: redact(item.args, 500) };
    return { ...item, text: redact(item.text, item.kind === "text" ? 4000 : 2000) };
  });
}
