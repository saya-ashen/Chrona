import { mkdir, writeFile } from "node:fs/promises";
import { OpenClawGatewayClient } from "../../src/modules/runtime/openclaw/client";
import { loadOpenClawPersistedDeviceIdentity } from "../../src/modules/runtime/openclaw/device-identity";
import { evaluateOpenClawGate } from "../../src/modules/runtime/openclaw/evaluate-gate";
import {
  collectOpenClawGateChecks,
  renderOpenClawGateMarkdown,
} from "../../src/modules/runtime/openclaw/probe";

function readGatewayUrl() {
  return process.env.OPENCLAW_GATEWAY_URL ?? process.env.OPENCLAW_BASE_URL;
}

function readAuth(deviceToken?: string) {
  const token = process.env.OPENCLAW_AUTH_TOKEN ?? process.env.OPENCLAW_API_KEY;
  const password = process.env.OPENCLAW_AUTH_PASSWORD;

   if (deviceToken) {
    return { deviceToken };
  }

  if (!token && !password) {
    throw new Error(
      "OPENCLAW_AUTH_TOKEN (or legacy OPENCLAW_API_KEY) / OPENCLAW_AUTH_PASSWORD is required",
    );
  }

  return { token, password };
}

async function main() {
  const gatewayUrl = readGatewayUrl();
  if (!gatewayUrl) {
    throw new Error("OPENCLAW_GATEWAY_URL (or legacy OPENCLAW_BASE_URL) is required");
  }

  const deviceIdentity = await loadOpenClawPersistedDeviceIdentity({
    identityDir: process.env.OPENCLAW_IDENTITY_DIR,
  });

  const client = new OpenClawGatewayClient({
    gatewayUrl,
    auth: readAuth(deviceIdentity?.deviceToken),
    deviceIdentity,
  });

  try {
    await client.connect();
    const checks = await collectOpenClawGateChecks(client);
    const report = evaluateOpenClawGate(checks);

    await mkdir("docs/research", { recursive: true });
    await writeFile(
      "docs/research/2026-04-08-openclaw-feasibility.md",
      renderOpenClawGateMarkdown(report),
    );

    if (report.overall === "fail") {
      process.exit(1);
    }
  } finally {
    client.close(1000, "probe-complete");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
