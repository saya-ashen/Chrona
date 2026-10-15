import type { StewardService, StewardPorts } from "@chrona/engine";
import { z } from "zod";

/** Only composed under CHRONA_E2E_TEST_ROUTES; no network or model calls. */
export function createStewardTestAgent(service: () => StewardService): NonNullable<StewardPorts["agent"]> {
  async function call(token: string, name: string, input: unknown) {
    const result = await service().agentEndpoint.callTool(token, name, input);
    if (!result.ok) throw new Error(`Scripted agent tool failed: ${name}`);
    return result.data;
  }
  return {
    async runConcierge({ token }) {
      const context = z.object({ messages: z.array(z.object({ direction: z.string(), text: z.string() })) }).parse(await call(token, "concierge_context", {}));
      const text = context.messages.filter(m => m.direction === "in").at(-1)?.text;
      if (!text) throw new Error("No test message");
      if (text.includes("调研")) {
        await call(token, "concierge_create_affair", { title: text.slice(0, 200), request: text });
      }
      await call(token, "concierge_reply", { text: "收到" });
    },
    async runAffair({ token }) {
      const context = z.object({ latestResult: z.object({ version: z.number() }).nullable() }).parse(await call(token, "chrona_get_context", {}));
      const version = (context.latestResult?.version ?? 0) + 1;
      await call(token, "chrona_set_care", { cadenceMinutes: 10080, notify: "web", why: "Keep the local fixture available for revision and pause tests" });
      await call(token, "chrona_publish_result", {
        title: `Test result v${version}`, summary: "Deterministic local result",
        body: `# Test result v${version}\n\nThis is a local test fixture, not real research.\n\n| Item | Finding |\n| --- | --- |\n| Fixture | Version ${version} |`,
        sources: [{ title: "Fixture source", url: "https://example.com/fixture", note: "Unverified local fixture; no HTTP request made." }],
        limitations: "Test data only", nextSteps: [], handling: { mode: "result_page", rationale: "One-off test response" },
      });
    },
  };
}
