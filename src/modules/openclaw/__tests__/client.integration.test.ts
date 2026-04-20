import { describe, expect, it } from "vitest";
import { OpenClawBridgeClient } from "@/modules/openclaw/bridge-client";

const integrationEnabled = process.env.OPENCLAW_INTEGRATION_TESTS === "1";
const bridgeConfigured = Boolean(process.env.OPENCLAW_BRIDGE_URL);
const describeIntegration = integrationEnabled && bridgeConfigured ? describe : describe.skip;

function createBridgeClient() {
  return new OpenClawBridgeClient({
    baseUrl: process.env.OPENCLAW_BRIDGE_URL,
    timeoutSeconds: process.env.OPENCLAW_TIMEOUT ? Number(process.env.OPENCLAW_TIMEOUT) : undefined,
  });
}

describeIntegration("OpenClawBridgeClient integration", () => {
  it("connects to the bridge and exposes health-backed methods", async () => {
    const client = createBridgeClient();
    const hello = await client.connect();

    expect(hello.protocol).toBe(1);
    expect(hello.methods).toEqual(expect.arrayContaining(["chat", "chat/stream", "health"]));
  });

  it("returns noop approval behavior in bridge mode", async () => {
    const client = createBridgeClient();

    await expect(client.resolveApproval({ approvalId: "x", decision: "approve" })).resolves.toEqual({ accepted: true });
    await expect(client.requestApproval({
      command: "printf openclaw-integration",
      cwd: ".",
      host: "bridge",
      sessionKey: "integration-session",
    })).resolves.toEqual({ approvalId: "noop", status: "auto-approved" });
  });
});
