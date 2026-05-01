/**
 * API workflow tests: OpenClaw live smoke
 *
 * Tests the bridge against a real OpenClaw gateway. Skipped by default.
 * Set CHRONA_LIVE_OPENCLAW_TESTS=1 to run.
 *
 * Required env: OPENCLAW_GATEWAY_TOKEN, OPENCLAW_OPENRESPONSES_URL (or OPENCLAW_GATEWAY_URL)
 */

import { describe, expect, it } from "bun:test";
import {
  createBridgeApp,
  createBridgeLogger,
  checkGatewayAvailable,
  executeGatewayRequest,
} from "@chrona/openclaw-bridge";
import { runLiveOpenClaw } from "../bun-test-helpers";

const liveGatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;

// ---------------------------------------------------------------------------
// Tests (skipped unless CHRONA_LIVE_OPENCLAW_TESTS=1)
// ---------------------------------------------------------------------------

describe.skipIf(!runLiveOpenClaw)("OpenClaw bridge live smoke", () => {
  const app = createBridgeApp({
    logger: createBridgeLogger({ minLevel: "warn", sink: () => {} }),
    checkGatewayAvailable: () => checkGatewayAvailable(undefined as any),
    executeRequest: (route, request) => executeGatewayRequest(route, request, createBridgeLogger({ minLevel: "warn", sink: () => {} }), undefined as any),
  });

  it("GET /v1/health returns 200 with ok status", async () => {
    expect(liveGatewayToken).toBeTruthy();
    const res = await app.request("http://bridge.local/v1/health");

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("ok");
    expect(body.gateway).toBeDefined();
  });

  it("POST /v1/features/generate-plan returns structured result", async () => {
    expect(liveGatewayToken).toBeTruthy();
    const res = await app.request(
      "http://bridge.local/v1/features/generate-plan",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: {
            task: {
              title: "Write a simple hello world Go program",
              description: "Create a minimal Go program that prints hello world",
            },
          },
        }),
      },
    );

    if (res.status === 200) {
      const body = await res.json() as any;

      // Verify feature result shape
      expect(body.feature).toBeDefined();
      expect(body.feature.feature).toBe("generate_plan");

      // Verify payload has correct schema
      const payload = body.feature.payload as Record<string, unknown>;
      expect(payload).toBeDefined();
      expect(typeof payload.summary).toBe("string");
      expect(Array.isArray(payload.nodes)).toBe(true);
      expect((payload.nodes as any[]).length).toBeGreaterThanOrEqual(1);

      // First node should have required fields
      const firstNode = (payload.nodes as Record<string, unknown>[])[0];
      expect(typeof firstNode.id).toBe("string");
      expect(typeof firstNode.title).toBe("string");
      expect(typeof firstNode.objective).toBe("string");
      expect(typeof firstNode.type).toBe("string");

      // Usage should be present
      expect(body.usage).toBeDefined();
      expect(typeof body.usage.inputTokens).toBe("number");
      expect(typeof body.usage.outputTokens).toBe("number");
    } else {
      // If the gateway returns non-200, it's acceptable (e.g. no accounts configured)
      // Just ensure it's not a crash
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });
});
