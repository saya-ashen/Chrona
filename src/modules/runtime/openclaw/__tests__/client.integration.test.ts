import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OpenClawGatewayClient } from "@/modules/runtime/openclaw/client";
import { loadOpenClawPersistedDeviceIdentity } from "@/modules/runtime/openclaw/device-identity";

function readGatewayUrl() {
  return process.env.OPENCLAW_GATEWAY_URL ?? process.env.OPENCLAW_BASE_URL;
}

function hasPersistedDeviceIdentity() {
  const identityDir = process.env.OPENCLAW_IDENTITY_DIR ?? join(homedir(), ".openclaw", "identity");
  return existsSync(join(identityDir, "device.json"));
}

const integrationEnabled = process.env.OPENCLAW_INTEGRATION_TESTS === "1";
const gatewayConfigured = Boolean(readGatewayUrl());
const authConfigured = Boolean(
  process.env.OPENCLAW_AUTH_TOKEN
    ?? process.env.OPENCLAW_API_KEY
    ?? process.env.OPENCLAW_AUTH_PASSWORD,
) || hasPersistedDeviceIdentity();
const describeIntegration = integrationEnabled && gatewayConfigured && authConfigured
  ? describe
  : describe.skip;

function readAuth(deviceToken?: string) {
  const token = process.env.OPENCLAW_AUTH_TOKEN ?? process.env.OPENCLAW_API_KEY;
  const password = process.env.OPENCLAW_AUTH_PASSWORD;

  if (deviceToken) {
    return { deviceToken };
  }

  if (!token && !password) {
    return null;
  }

  return { token, password };
}

async function createGatewayClient() {
  const gatewayUrl = readGatewayUrl();
  if (!gatewayUrl) return null;

  const deviceIdentity = await loadOpenClawPersistedDeviceIdentity({
    identityDir: process.env.OPENCLAW_IDENTITY_DIR,
  });

  const auth = readAuth(deviceIdentity?.deviceToken);
  if (!auth) return null;

  return new OpenClawGatewayClient({ gatewayUrl, auth, deviceIdentity });
}

describeIntegration("OpenClawGatewayClient integration", () => {
  it("connects to the gateway and exposes hello methods", async () => {
    const client = await createGatewayClient();
    expect(client).not.toBeNull();

    try {
      const hello = await client!.connect();
      expect(hello.protocol).toBe(3);
      expect(hello.methods).toEqual(expect.arrayContaining(["sessions.create"]));
      expect(hello.methods.length).toBeGreaterThan(0);
    } finally {
      client?.close(1000, "integration-complete");
    }
  });

  it("can request and resolve approval when supported", async () => {
    const client = await createGatewayClient();
    expect(client).not.toBeNull();

    try {
      const hello = await client!.connect();
      expect(hello.methods).toContain("exec.approval.request");
      expect(hello.methods).toContain("exec.approval.resolve");

      const request = await client!.requestApproval({
        command: "printf openclaw-integration",
        cwd: ".",
        host: "gateway",
        sessionKey: "integration-session",
      });

      expect(request.approvalId).not.toBe("");
      expect(["pending", "accepted", "queued", "requested", undefined]).toContain(
        request.status,
      );

      const resolved = await client!.resolveApproval({
        approvalId: request.approvalId,
        decision: "approve",
      });

      expect(resolved).toEqual({ accepted: true });
    } finally {
      client?.close(1000, "integration-complete");
    }
  });
});
