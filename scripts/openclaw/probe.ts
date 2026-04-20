import { mkdir, writeFile } from "node:fs/promises";
import { OpenClawBridgeClient } from "../../src/modules/openclaw/bridge-client";
import { evaluateOpenClawGate } from "../../src/modules/openclaw/evaluate-gate";
import {
  collectOpenClawGateChecks,
  renderOpenClawGateMarkdown,
} from "../../src/modules/openclaw/probe";

async function main() {
  const client = new OpenClawBridgeClient({
    baseUrl: process.env.OPENCLAW_BRIDGE_URL,
    timeoutSeconds: process.env.OPENCLAW_TIMEOUT ? Number(process.env.OPENCLAW_TIMEOUT) : undefined,
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
    client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
