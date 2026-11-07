import { providerUsageSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { entryConversations } from "./sessions";
import { sessionSettings } from "./settings";

/** Facts for an entry's conversation policy. No title, idle threshold or rotation decision is made here. */
export async function conversationState(ports: StewardPorts, workspaceId: string, key: string) {
  const { db } = ports, session = await db.session.findFirst({ where: { workspaceId, key, status: "active", ...await entryConversations(db, workspaceId) } });
  const limits = sessionSettings((await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings);
  if (!session) return { now: ports.now().toISOString(), limits, session: null };
  const busy = await db.run.count({ where: { workspaceId, sessionId: session.id, status: { in: ["queued", "running"] } } }) > 0;
  const run = await db.run.findFirst({ where: { workspaceId, sessionId: session.id, status: "finished" }, orderBy: [{ endedAt: "desc" }, { id: "desc" }], select: { id: true } });
  const events = run ? await db.audit.findMany({ where: { workspaceId, kind: "provider_event", subjectId: run.id }, orderBy: { id: "desc" }, take: 400, select: { details: true } }) : [];
  const usage = events.map(row => row.details as { type?: unknown; value?: unknown } | null).find(details => details?.type === "usage");
  const contextTokens = providerUsageSchema.safeParse(usage?.value).data?.contextTokens ?? 0;
  return { now: ports.now().toISOString(), limits, session: { id: session.id, title: session.title, lastActivityAt: session.lastActivityAt.toISOString(), busy, contextTokens } };
}
