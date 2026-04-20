/**
 * Real integration tests for OpenClaw Bridge.
 * These call the actual bridge server and openclaw CLI — NOT mocked.
 *
 * Requires:
 *   - OpenClaw bridge running on localhost:7677
 *   - openclaw CLI installed and configured
 *
 * Run: bunx vitest run src/modules/openclaw/__tests__/bridge.integration.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";

const BRIDGE_URL = process.env.OPENCLAW_BRIDGE_URL ?? "http://localhost:7677";

async function bridgeAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE_URL}/v1/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { status: string };
    return body.status === "ok";
  } catch {
    return false;
  }
}

describe("OpenClaw Bridge (real)", () => {
  let available = false;

  beforeAll(async () => {
    available = await bridgeAvailable();
    if (!available) {
      console.warn("⚠️  OpenClaw bridge not available at", BRIDGE_URL, "— skipping bridge tests");
    }
  });

  it("health check returns ok", async () => {
    if (!available) return;
    const res = await fetch(`${BRIDGE_URL}/v1/health`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { status: string; bin: string };
    expect(body.status).toBe("ok");
    expect(body.bin).toBeTruthy();
  });

  it("blocking chat returns a response", async () => {
    if (!available) return;

    const res = await fetch(`${BRIDGE_URL}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: `test-${Date.now()}`,
        message: "What is 2+2? Reply with just the number.",
        timeout: 30,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      sessionId: string;
      output: string;
      toolCalls: unknown[];
      error: string | null;
      durationMs: number;
    };

    expect(body.sessionId).toBeTruthy();
    expect(body.output).toBeTruthy();
    expect(body.output).toContain("4");
    expect(body.error).toBeNull();
    expect(body.durationMs).toBeGreaterThan(0);
  }, 60_000);

  it("streaming chat returns SSE events then done", async () => {
    if (!available) return;

    const res = await fetch(`${BRIDGE_URL}/v1/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: `test-stream-${Date.now()}`,
        message: "Say hi.",
        timeout: 30,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    expect(res.ok).toBe(true);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    // Should contain SSE format
    expect(text).toContain("event:");
    expect(text).toContain("data:");
    // Should end with a "done" event
    expect(text).toContain("event: done");
  }, 60_000);

  it("returns error for empty message", async () => {
    if (!available) return;

    const res = await fetch(`${BRIDGE_URL}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "test-err", message: "" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown endpoints", async () => {
    if (!available) return;

    const res = await fetch(`${BRIDGE_URL}/v1/unknown`);
    expect(res.status).toBe(404);
  });
});

describe("OpenClaw BridgeClient (real)", () => {
  let available = false;

  beforeAll(async () => {
    available = await bridgeAvailable();
  });

  it("connect returns protocol info", async () => {
    if (!available) return;

    const { OpenClawBridgeClient } = await import("../bridge-client");
    const client = new OpenClawBridgeClient({ baseUrl: BRIDGE_URL });
    const hello = await client.connect();

    expect(hello.protocol).toBe(1);
    expect(hello.methods).toContain("chat");
  });

  it("createRun sends message and gets response", async () => {
    if (!available) return;

    const { OpenClawBridgeClient } = await import("../bridge-client");
    const client = new OpenClawBridgeClient({
      baseUrl: BRIDGE_URL,
      timeoutSeconds: 30,
    });

    const result = await client.createRun({
      prompt: "What is 3+3? Reply with just the number.",
      runtimeSessionKey: `test-createRun-${Date.now()}`,
    });

    expect(result.runStarted).toBe(true);
    expect(result.runtimeRunRef).toBeTruthy();
    expect(result.runtimeSessionKey).toBeTruthy();
  }, 60_000);

  it("readOutputs returns conversation history after createRun", async () => {
    if (!available) return;

    const { OpenClawBridgeClient } = await import("../bridge-client");
    const client = new OpenClawBridgeClient({
      baseUrl: BRIDGE_URL,
      timeoutSeconds: 30,
    });

    const sessionKey = `test-history-${Date.now()}`;
    await client.createRun({
      prompt: "Say OK.",
      runtimeSessionKey: sessionKey,
    });

    const history = await client.readOutputs(sessionKey);
    expect(history.messages.length).toBeGreaterThanOrEqual(2);
    expect(history.messages[0]).toMatchObject({ role: "user" });
    expect(history.messages[1]).toMatchObject({ role: "assistant" });
  }, 60_000);
});
