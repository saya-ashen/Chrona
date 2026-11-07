import { join } from "node:path";
import type { ProviderTranscriptItem } from "@chrona/contracts/steward";
import { redactSensitiveText } from "@chrona/logging/redaction";
import type { StewardPorts } from "./ports";
import { runtimeCall } from "./local-runtime";

export type TranscriptItem = ProviderTranscriptItem;
const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max)}…（已截断）` : text;
/** Redaction is a kernel boundary, independent of the selected Provider. Always redact before clipping. */
function redactor() {
  const values = Object.entries(process.env).filter(([key, value]) => /(KEY|TOKEN|SECRET|PASSWORD)/i.test(key) && value && value.length >= 8).map(([, value]) => value!);
  return (text: string, limit: number) => clip(redactSensitiveText(values.reduce((out, value) => out.replaceAll(value, "[redacted]"), text).replace(/\bxox[abp]-[A-Za-z0-9_-]{16,}/g, "[redacted]"), Number.MAX_SAFE_INTEGER), limit);
}
/** Backend file formats stay in the adapter; chat owns scoped access and sanitized, bounded output. */
export async function sessionTranscript(ports: StewardPorts, sessionId: string, limit = 300): Promise<TranscriptItem[]> {
  if (!ports.provider?.transcript) return [];
  const count = Math.min(300, Math.max(1, limit)), redact = redactor();
  const session = await ports.db.session.findUniqueOrThrow({ where: { id: sessionId }, select: { workspaceId: true } });
  const items = await runtimeCall<ProviderTranscriptItem[]>(ports, session.workspaceId, "agent.transcript", { sessionDir: join(ports.dataDir, "sessions", sessionId, ".chrona", "sessions"), limit: count });
  return items.slice(-count).map(item => {
    if (item.kind === "tool") return { ...item, args: redact(item.args, 500) };
    return { ...item, text: redact(item.text, item.kind === "text" ? 4000 : 2000) };
  });
}
