import { join } from "node:path";
import type { ProviderTranscriptItem } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { runtimeCall } from "./local-runtime";

export type TranscriptItem = ProviderTranscriptItem;
import { transcriptRedactor } from "../../../../integrations/src/steward/transcript-redaction";
/** Backend file formats stay in the adapter; chat owns scoped access and sanitized, bounded output. */
export async function sessionTranscript(ports: StewardPorts, sessionId: string, limit = 300): Promise<TranscriptItem[]> {
  if (!ports.provider?.transcript) return [];
  const count = Math.min(300, Math.max(1, limit)), redact = transcriptRedactor();
  const session = await ports.db.session.findUniqueOrThrow({ where: { id: sessionId }, select: { workspaceId: true } });
  const items = await runtimeCall<ProviderTranscriptItem[]>(ports, session.workspaceId, "agent.transcript", { sessionDir: join(ports.dataDir, "sessions", sessionId, ".chrona", "sessions"), limit: count });
  return items.slice(-count).map(item => {
    if (item.kind === "tool") return { ...item, args: redact(item.args, 500) };
    return { ...item, text: redact(item.text, item.kind === "text" ? 4000 : 2000) };
  });
}
