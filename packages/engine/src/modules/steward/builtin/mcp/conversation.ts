type IdleSession = { id: string; lastActivityAt: string };
/** MCP owns its one-day idle-session policy; the kernel fences concurrent work. */
export async function endIdleConversations(call: Call, now = new Date()) {
  const sessions = await call("chat.sessions", { source: "mcp", status: "active" }) as IdleSession[];
  for (const session of sessions) if (now.getTime() - Date.parse(session.lastActivityAt) > 86400000)
    await call("chat.end-idle", { session: session.id, "last-activity-at": session.lastActivityAt });
}
type Call = (target: string, args: Record<string, unknown>) => Promise<unknown>;
type State = { now: string; limits: { idleMinutes: number; minContextTokens: number; maxContextTokens: number }; session: { id: string; title: string | null; lastActivityAt: string; busy: boolean; contextTokens: number } | null };
/** MCP keys follow its entry policy. An explicitly addressed session is never rotated implicitly. */
export async function conversationOptions(call: Call, key: string, text: string) {
  const { session, now, limits } = await call("chat.conversation-state", { key }) as State;
  const idle = session && Date.parse(now) - Date.parse(session.lastActivityAt) >= limits.idleMinutes * 60_000;
  const rotate = session && !session.busy && (session.contextTokens >= limits.maxContextTokens || (idle && session.contextTokens >= limits.minContextTokens));
  const line = [...text.trim().split(/\r?\n/, 1)[0]!.trim()];
  return { guidance: "You are Chrona, the user's personal steward. Use the user's language, default Chinese. Discover available apps and follow their tools. Repeated rule-stable work can become an external app; coordinate changes spanning apps in one build. Use proactive notifications sparingly and make scheduled instructions self-contained. For module builds, keep implementations minimal and deterministic, prefer mature libraries, self-test and fix reports within the authorized budget. Choose the cheapest reliable configured model tier. Check pages at 1440x900, 1024x768 and 390x844. After a build completes, continue any remaining work already authorized in this conversation; otherwise report its verified result.", ...((!session?.title || rotate) && line.length ? { title: line.length > 40 ? `${line.slice(0, 40).join("")}…` : line.join("") } : {}),
    ...(rotate ? { rotation: JSON.stringify({ sessionId: session.id, lastActivityAt: session.lastActivityAt }) } : {}) };
}
