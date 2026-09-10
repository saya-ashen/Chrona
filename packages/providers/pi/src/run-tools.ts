import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isExactLoopbackHost, type ProviderToolDefinition, type StartRunInput } from "@chrona/providers-foundation";
import { record } from "./rpc";

const TERMINAL_KINDS: Record<string, string> = {
  chrona_node_complete: "complete", chrona_condition_select: "condition_select",
  chrona_wait_complete: "wait_complete", chrona_node_block: "block",
  chrona_node_fail: "fail", chrona_node_request_input: "request_input",
};
export type ToolReply = { content: Array<{ type: "text"; text: string }>; details?: unknown; terminate?: boolean };

function apiUrl(base: string) {
  const url = new URL(base.replace(/\/+$/, ""));
  if (!isExactLoopbackHost(url.hostname) || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Pi requires a credential-free loopback Chrona control URL");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "").replace(/\/api$/, "")}/api`;
  return url;
}
function toolName(name: string) { return name.replace(/[^a-zA-Z0-9_-]/g, "_"); }

export class PiRunTools {
  readonly tools: ProviderToolDefinition[] = [];
  private readonly mcpNames = new Map<string, string>();
  private client?: Client;
  private terminalClaimed = false;

  constructor(private readonly input: StartRunInput, private readonly signal: AbortSignal) {}

  private addDeclaredTools() {
    for (const tool of this.input.tools ?? []) {
      if (tool.name !== toolName(tool.name)) throw new Error("Pi declared tool names must be wire-safe");
      if (TERMINAL_KINDS[tool.name] && !this.input.control) throw new Error("Pi execution control tools require run-scoped authorization");
      this.tools.push(tool);
    }
  }

  async initialize() {
    if (this.input.control && this.input.toolPolicy === "terminal_only") throw new Error("Isolated Pi features cannot receive execution authority");
    this.addDeclaredTools();
    if (!this.input.control) return;
    const url = apiUrl(this.input.control.baseUrl);
    url.pathname += "/mcp";
    url.searchParams.set("session_id", this.input.sessionId);
    const client = new Client({ name: "chrona-pi", version: "1.0.0" });
    this.client = client;
    await client.connect(new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${this.input.control.runToken}` }, signal: this.signal, redirect: "error" },
    }));
    await this.loadCatalog(client);
  }

  private async loadCatalog(client: Client) {
    let cursor: string | undefined;
    for (let page = 0; page < 8; page++) {
      const result = await client.listTools(cursor ? { cursor } : undefined, { signal: this.signal });
      for (const tool of result.tools) {
        const name = toolName(tool.name);
        if (this.mcpNames.has(name)) throw new Error("Pi control tool names collide");
        this.mcpNames.set(name, tool.name);
        const entry = { name, description: tool.description, inputSchema: tool.inputSchema } as ProviderToolDefinition;
        const index = this.tools.findIndex((item) => item.name === name);
        if (index < 0) this.tools.push(entry); else this.tools[index] = entry;
      }
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    if (cursor || this.mcpNames.size === 0) throw new Error("Pi did not receive a bounded Chrona tool catalog");
  }

  isTerminal(name: string) { return name === this.input.terminalToolName || Boolean(this.input.control && TERMINAL_KINDS[name]); }

  async call(name: string, args: Record<string, unknown>): Promise<ToolReply> {
    if (!this.tools.some((tool) => tool.name === name)) throw new Error("Pi requested an undeclared bridge tool");
    const terminal = this.isTerminal(name);
    if (this.terminalClaimed) throw new Error("Pi already submitted a terminal result");
    if (terminal) this.terminalClaimed = true;
    // A terminal submission with an uncertain network outcome is never replayed.
    const kind = TERMINAL_KINDS[name];
    if (kind && this.input.control) return this.submitControl(kind, args);
    const native = this.mcpNames.get(name);
    if (native && this.client) {
      const result = await this.client.callTool({ name: native, arguments: args }, undefined, { signal: this.signal });
      if (result.isError) throw new Error("Chrona rejected the Pi tool call");
      const text = JSON.stringify(result);
      if (Buffer.byteLength(text) > 64 * 1024) throw new Error("Chrona tool response exceeds Pi bridge limit");
      return { content: [{ type: "text", text }] };
    }
    if (!terminal) throw new Error("Pi does not support engine-managed action tools");
    return { content: [{ type: "text", text: "Structured result received." }], terminate: true };
  }

  private async submitControl(kind: string, payload: Record<string, unknown>): Promise<ToolReply> {
    const control = this.input.control!;
    const url = apiUrl(control.baseUrl);
    url.pathname += "/agent/control";
    const response = await fetch(url, {
      method: "POST", redirect: "error", signal: this.signal,
      headers: { Authorization: `Bearer ${control.runToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ body: { kind, payload } }),
    });
    if (!response.ok) throw new Error("Chrona rejected the Pi terminal action");
    const value = record(await response.json());
    if (value.ok !== true || value.kind !== kind || (value.recorded !== true && value.alreadyAccepted !== true)) {
      throw new Error("Chrona did not durably acknowledge the Pi terminal action");
    }
    return { content: [{ type: "text", text: "Chrona recorded the terminal action." }], terminate: true };
  }

  async close() { await this.client?.close().catch(() => undefined); }
}
