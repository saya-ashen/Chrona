type Call = (target: string, args: Record<string, unknown>) => Promise<unknown>;
type State = { now: string; limits: { idleMinutes: number; minContextTokens: number; maxContextTokens: number }; session: { id: string; title: string | null; lastActivityAt: string; busy: boolean; contextTokens: number } | null };
/** QQ owns its DM titles and context-cost policy; /new remains an explicit user action. */
export async function conversationOptions(call: Call, key: string, text: string) {
  const { session, now, limits } = await call("chat.conversation-state", { key }) as State;
  const idle = session && Date.parse(now) - Date.parse(session.lastActivityAt) >= limits.idleMinutes * 60_000;
  const rotate = session && !session.busy && (session.contextTokens >= limits.maxContextTokens || (idle && session.contextTokens >= limits.minContextTokens));
  const line = [...text.trim().split(/\r?\n/, 1)[0]!.trim()];
  return { guidance: "You are Chrona, the user's personal steward in QQ. Use the user's language, default Chinese. Discover available apps and follow their tools. Repeated rule-stable work can become an external app; changes spanning apps belong in one build. Use proactive notifications sparingly; scheduled work starts with a fresh context, so instructions must be self-contained. For module builds, keep implementations minimal and deterministic, prefer mature libraries, self-test and fix reports within the authorized budget. Choose the cheapest reliable configured model tier. Check pages at 1440x900, 1024x768 and 390x844. After a build completes, continue any remaining work already authorized in this conversation; otherwise report its verified result.", ...((!session?.title || rotate) && line.length ? { title: line.length > 40 ? `${line.slice(0, 40).join("")}…` : line.join("") } : {}),
    ...(rotate ? { rotation: JSON.stringify({ sessionId: session.id, lastActivityAt: session.lastActivityAt }) } : {}) };
}
