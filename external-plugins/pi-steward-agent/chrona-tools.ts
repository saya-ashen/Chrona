/**
 * Pi extension loaded by Chrona's agent runner for ONE work attempt. It only forwards tool calls
 * to Chrona's loopback agent endpoint; Chrona validates, scopes, budgets and applies every effect.
 * Host web tools (pi-web-access) pass Chrona's preflight first; every other tool is blocked.
 * Not compiled by Chrona: Pi loads it with jiti, which provides "typebox".
 */
import { Type } from "typebox";

const WEB_TOOLS = new Set(["web_search", "fetch_content"]);
const WEB_RESULT_CHARS = 12_000;
const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/g;
const base = process.env.CHRONA_AGENT_URL ?? "";
const token = process.env.CHRONA_AGENT_TOKEN ?? "";

type Catalog = { tools: { name: string; description: string; parameters: Record<string, unknown>; terminal: boolean }[] };

async function call(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Chrona agent endpoint returned HTTP ${response.status}`);
  return response.json();
}

function textOf(content: unknown): string {
  return Array.isArray(content) ? content.map(part => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "")).join("\n") : "";
}

export default async function (pi: any) {
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/api\/steward-agent$/.test(base) || !token) return;
  const catalog = await call("/catalog", undefined, 5000) as Catalog;
  const names = new Set<string>();
  let finished = false, nudges = 0;
  for (const tool of catalog.tools) {
    names.add(tool.name);
    pi.registerTool({
      name: tool.name, label: tool.name, description: tool.description, parameters: Type.Unsafe(tool.parameters),
      async execute(_id: string, params: unknown) {
        const result = await call(`/tools/${encodeURIComponent(tool.name)}`, params ?? {}, 60_000) as { ok: boolean; data?: unknown; error?: { code: string; message: string } };
        if (!result.ok) throw new Error(`${result.error?.code ?? "ERROR"}: ${result.error?.message ?? "refused"}`);
        if (tool.terminal) finished = true;
        return { content: [{ type: "text", text: JSON.stringify(result.data ?? null).slice(0, 30_000) }], details: undefined, terminate: tool.terminal };
      },
    });
  }
  // A run must end through a Chrona terminal tool; prose alone changes nothing. Nudge at most twice.
  pi.on("turn_end", async (event: { message?: { content?: { type: string }[] } }) => {
    const calledTools = (event.message?.content ?? []).some(part => part.type === "toolCall");
    if (finished || calledTools || nudges >= 2) return undefined;
    nudges++;
    await pi.sendUserMessage(`Chrona: this run has not ended. Your text answer is not saved. Call exactly one terminal tool now: ${catalog.tools.filter(tool => tool.terminal).map(tool => tool.name).join(", ")}.`, { deliverAs: "followUp" });
    return undefined;
  });
  pi.on("tool_call", async (event: { toolName: string; input: Record<string, unknown> }) => {
    if (names.has(event.toolName)) return undefined;
    if (!WEB_TOOLS.has(event.toolName)) return { block: true, reason: "Only Chrona work tools and approved web tools are available." };
    try {
      const verdict = await call("/web/preflight", { tool: event.toolName, input: event.input ?? {} }, 10_000) as { allow: boolean; input?: Record<string, unknown>; reason?: string };
      if (!verdict.allow || !verdict.input) return { block: true, reason: `Chrona refused this web call: ${verdict.reason ?? "denied"}` };
      for (const key of Object.keys(event.input)) delete event.input[key];
      Object.assign(event.input, verdict.input);
      return undefined;
    } catch {
      return { block: true, reason: "Chrona web preflight unavailable." };
    }
  });
  pi.on("tool_result", async (event: { toolName: string; content?: unknown; isError?: boolean }) => {
    if (!WEB_TOOLS.has(event.toolName)) return undefined;
    const urls = [...new Set(textOf(event.content).match(URL_PATTERN) ?? [])].map(url => url.replace(/[.,;:!?]+$/, "")).filter(url => url.length <= 2048).slice(0, 50);
    try { await call("/web/observed", { tool: event.toolName, urls, titles: [], failed: event.isError === true }, 10_000); } catch { /* Observation is best effort; unverified sources stay unverified. */ }
    // Keep each web result small so long pages cannot exhaust the run's context before it finishes.
    const text = textOf(event.content);
    if (text.length <= WEB_RESULT_CHARS) return undefined;
    return { content: [{ type: "text", text: `${text.slice(0, WEB_RESULT_CHARS)}\n[Chrona truncated this ${event.toolName} result from ${text.length} characters; fetch a narrower page or ask for specific passages.]` }], structuredContent: undefined };
  });
}
