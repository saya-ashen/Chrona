/**
 * OpenClaw CLI Bridge — HTTP service that wraps `openclaw agent` CLI.
 *
 * Runs on the same machine as OpenClaw. Exposes a simple REST API
 * that spawns `openclaw agent --local --json` subprocesses and
 * parses the output from stderr.
 *
 * Output format handling:
 *   The CLI writes machine-readable JSON to stderr in one of two formats:
 *   (A) NDJSON stream — one JSON event per line (text, tool_use, etc.)
 *   (B) Single JSON blob — { payloads, meta } at the end of stderr
 *   The bridge detects and handles both.
 *
 * Endpoints:
 *   POST /v1/chat          — send a message, get full response (blocking)
 *   POST /v1/chat/stream   — send a message, get SSE stream of events
 *   GET  /v1/health        — check if openclaw CLI is available
 *
 * Request body (POST):
 *   {
 *     "sessionId": "optional-session-id",
 *     "message": "user message",
 *     "systemPrompt": "optional-system-prompt",
 *     "timeout": 300
 *   }
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

export interface BridgeRequest {
  sessionId?: string;
  message: string;
  systemPrompt?: string;
  timeout?: number;
}

export interface ToolCallInfo {
  tool: string;
  callId: string;
  input: Record<string, unknown>;
  result?: string;
  status: "pending" | "completed" | "error";
}

export interface BridgeResponse {
  sessionId: string;
  output: string;
  toolCalls: ToolCallInfo[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  } | null;
  error: string | null;
  durationMs: number;
}

export interface NDJSONEvent {
  type: string;
  sessionId?: string;
  text?: string;
  tool?: string;
  callId?: string;
  input?: Record<string, unknown>;
  error?: { name?: string; data?: { message?: string } };
  phase?: string;
  message?: string;
  usage?: Record<string, number>;
}

// ── Legacy single-blob format ──
interface LegacyBlobPayload {
  text: string | null;
  mediaUrl?: string | null;
}
interface LegacyBlobMeta {
  durationMs?: number;
  agentMeta?: {
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  stopReason?: string;
}
interface LegacyBlob {
  payloads?: LegacyBlobPayload[];
  meta?: LegacyBlobMeta;
}

// ────────────────────────────────────────────────────────────────────
// CLI Executor
// ────────────────────────────────────────────────────────────────────

const OPENCLAW_BIN = process.env.OPENCLAW_BIN ?? "openclaw";

export async function checkCLIAvailable(): Promise<boolean> {
  try {
    const proc = spawn(OPENCLAW_BIN, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    return new Promise((resolve) => {
      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  } catch {
    return false;
  }
}

/**
 * Try to extract the final multi-line JSON blob from stderr output.
 * Returns null if no valid JSON blob found.
 */
function extractFinalBlob(text: string): LegacyBlob | null {
  // Walk backward to find the last matching { ... }
  let braceCount = 0;
  let end = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === "}") {
      if (braceCount === 0) end = i + 1;
      braceCount++;
    } else if (text[i] === "{") {
      braceCount--;
      if (braceCount === 0) {
        try {
          return JSON.parse(text.slice(i, end)) as LegacyBlob;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Parse NDJSON events from stderr lines.
 * Returns only valid JSON lines that look like protocol events.
 */
function parseNDJSONEvents(lines: string[]): NDJSONEvent[] {
  const events: NDJSONEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    try {
      const obj = JSON.parse(trimmed) as NDJSONEvent;
      if (obj.type) events.push(obj);
    } catch {
      // skip
    }
  }
  return events;
}

export function executeAgent(
  request: BridgeRequest,
  onEvent?: (event: NDJSONEvent) => void,
): Promise<BridgeResponse> {
  const sessionId = request.sessionId ?? randomUUID();
  const startTime = Date.now();

  const args = ["agent", "--local", "--json"];
  args.push("--session-id", sessionId);

  // Build message with optional system prompt prefix
  let message = request.message;
  if (request.systemPrompt) {
    message = `[System Prompt]\n${request.systemPrompt}\n\n[User Message]\n${message}`;
  }
  args.push("--message", message);

  if (request.timeout) {
    args.push("--timeout", String(request.timeout));
  }

  return new Promise((resolve) => {
    const proc = spawn(OPENCLAW_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      timeout: (request.timeout ?? 300) * 1000 + 10000,
    });

    const stderrChunks: string[] = [];
    const stderrLines: string[] = [];

    // ── Collect NDJSON events in real-time ──
    const textChunks: string[] = [];
    const toolCalls = new Map<string, ToolCallInfo>();
    let usage: { inputTokens: number; outputTokens: number } | null = null;
    let errorMessage: string | null = null;
    let gotNDJSON = false;

    let buffer = "";
    proc.stderr!.on("data", (chunk: Buffer) => {
      const str = chunk.toString();
      stderrChunks.push(str);

      // Process line by line for NDJSON
      buffer += str;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep incomplete last line

      for (const line of lines) {
        stderrLines.push(line);
        const trimmed = line.trim();
        if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;

        let event: NDJSONEvent;
        try {
          event = JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (!event.type) continue;
        gotNDJSON = true;
        onEvent?.(event);
        processEvent(event);
      }
    });

    function processEvent(event: NDJSONEvent) {
      switch (event.type) {
        case "text":
          if (event.text) textChunks.push(event.text);
          break;
        case "tool_use":
          if (event.callId) {
            toolCalls.set(event.callId, {
              tool: event.tool ?? "unknown",
              callId: event.callId,
              input: event.input ?? {},
              status: "pending",
            });
          }
          break;
        case "tool_result":
          if (event.callId && toolCalls.has(event.callId)) {
            const tc = toolCalls.get(event.callId)!;
            tc.result = event.text;
            tc.status = "completed";
          }
          break;
        case "step_finish":
          if (event.usage) {
            const u = event.usage;
            usage = {
              inputTokens: (u.inputTokens ?? u.input_tokens ?? u.prompt_tokens ?? 0) as number,
              outputTokens: (u.outputTokens ?? u.output_tokens ?? u.completion_tokens ?? 0) as number,
            };
          }
          break;
        case "error":
          errorMessage = event.text ?? event.error?.data?.message ?? event.error?.name ?? "Unknown error";
          break;
        case "lifecycle":
          if (event.phase === "failed" || event.phase === "error" || event.phase === "cancelled") {
            errorMessage = event.message ?? `Lifecycle: ${event.phase}`;
          }
          break;
      }
    }

    // Collect stdout (logs, not protocol)
    proc.stdout!.on("data", () => { /* discard */ });

    proc.on("close", (code) => {
      // Process remaining buffer
      if (buffer.trim()) {
        stderrLines.push(buffer);
      }

      const fullStderr = stderrChunks.join("");

      // If no NDJSON events were found, try the legacy blob format
      if (!gotNDJSON) {
        const blob = extractFinalBlob(fullStderr);
        if (blob) {
          // Extract text from payloads
          const blobText = (blob.payloads ?? [])
            .map((p) => p.text ?? "")
            .filter(Boolean)
            .join("\n");

          if (blobText) textChunks.push(blobText);

          // Extract usage
          const blobUsage = blob.meta?.agentMeta?.usage;
          if (blobUsage) {
            usage = {
              inputTokens: blobUsage.inputTokens ?? blobUsage.input_tokens ?? 0,
              outputTokens: blobUsage.outputTokens ?? blobUsage.output_tokens ?? 0,
            };
          }

          // Check for error
          if (blob.meta?.stopReason === "error" && !errorMessage) {
            const errorText = textChunks.join("");
            if (errorText.includes("unavailable") || errorText.includes("error")) {
              errorMessage = errorText;
            }
          }
        }
      }

      resolve({
        sessionId,
        output: textChunks.join(""),
        toolCalls: Array.from(toolCalls.values()),
        usage,
        error: errorMessage ?? (code !== 0 && code !== null ? `Process exited with code ${code}` : null),
        durationMs: Date.now() - startTime,
      });
    });

    proc.on("error", (err) => {
      resolve({
        sessionId,
        output: textChunks.join(""),
        toolCalls: Array.from(toolCalls.values()),
        usage,
        error: `Spawn error: ${err.message}`,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

// ────────────────────────────────────────────────────────────────────
// HTTP Server (Bun.serve)
// ────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.OPENCLAW_BRIDGE_PORT ?? 7677);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // ── Health check ──
  if (url.pathname === "/v1/health" && req.method === "GET") {
    const available = await checkCLIAvailable();
    return Response.json(
      { status: available ? "ok" : "unavailable", bin: OPENCLAW_BIN },
      { headers: CORS_HEADERS },
    );
  }

  // ── Blocking chat ──
  if (url.pathname === "/v1/chat" && req.method === "POST") {
    const body = await parseBody(req);
    if (body instanceof Response) return body;

    const result = await executeAgent(body);
    return Response.json(result, { headers: CORS_HEADERS });
  }

  // ── Streaming chat (SSE) ──
  if (url.pathname === "/v1/chat/stream" && req.method === "POST") {
    const body = await parseBody(req);
    if (body instanceof Response) return body;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        function send(eventName: string, data: unknown) {
          controller.enqueue(
            encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        }

        executeAgent(body, (event) => send("event", event))
          .then((result) => {
            send("done", result);
            controller.close();
          })
          .catch((err) => {
            send("error", { error: String(err) });
            controller.close();
          });
      },
    });

    return new Response(stream, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  return Response.json(
    { error: "Not found", endpoints: ["GET /v1/health", "POST /v1/chat", "POST /v1/chat/stream"] },
    { status: 404, headers: CORS_HEADERS },
  );
}

async function parseBody(req: Request): Promise<BridgeRequest | Response> {
  let body: BridgeRequest;
  try {
    body = (await req.json()) as BridgeRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }
  if (!body.message) {
    return Response.json({ error: "message is required" }, { status: 400, headers: CORS_HEADERS });
  }
  return body;
}

// ── Start server ──

console.log(`🦞 OpenClaw CLI Bridge starting on port ${PORT}...`);
const available = await checkCLIAvailable();
if (!available) {
  console.error(`⚠️  Warning: '${OPENCLAW_BIN}' not found. Bridge will return errors.`);
} else {
  console.log(`✓ OpenClaw CLI found at '${OPENCLAW_BIN}'`);
}

Bun.serve({ port: PORT, fetch: handleRequest });
console.log(`✓ Bridge listening on http://localhost:${PORT}`);
console.log(`  POST /v1/chat          — blocking`);
console.log(`  POST /v1/chat/stream   — SSE`);
console.log(`  GET  /v1/health        — health check`);
