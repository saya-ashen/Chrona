import { mkdir, writeFile } from "node:fs/promises";
import { OpenClawEmbeddedClient } from "@chrona/openclaw-integration";
import { evaluateOpenClawGate } from "@chrona/openclaw-integration";
import {
  collectOpenClawGateChecks,
  renderOpenClawGateMarkdown,
} from "@chrona/openclaw-integration";

async function main() {
  const client = new OpenClawEmbeddedClient({
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
