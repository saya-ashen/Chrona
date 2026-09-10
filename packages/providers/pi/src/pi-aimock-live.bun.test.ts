import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LLMock } from "@copilotkit/aimock";
import type { StartRunInput } from "@chrona/providers-foundation";
import { PiProviderClient } from "./PiProviderClient";

async function fixture(mock: LLMock) {
  await mock.start();
  const root = await mkdtemp(join(tmpdir(), "chrona-pi-live-"));
  const agent = join(root, "agent");
  await mkdir(join(agent, "extensions"), { recursive: true });
  await writeFile(join(agent, "models.json"), JSON.stringify({ providers: {
    "chrona-test": { baseUrl: `${mock.url}/v1`, api: "openai-completions", apiKey: "fixture-key",
      models: [{ id: "test-model", reasoning: false, contextWindow: 128000, maxTokens: 4096 }] },
  } }));
  await writeFile(join(agent, "extensions", "marker.ts"), `export default function(pi) {
    pi.registerTool({name:"local_marker",label:"marker",description:"fixture only",
      parameters:{type:"object",properties:{},additionalProperties:false},
      async execute(){return {content:[{type:"text",text:"LOCAL_EXTENSION_EXECUTED"}],details:{}}}
    });
  }`);
  const config = { cwd: root, codingAgentDirectory: agent, model: "chrona-test/test-model", timeoutMs: 20_000 };
  return { root, agent, config, client: new PiProviderClient({ config, stateDirectory: join(root, "state") }),
    close: async () => { await mock.stop(); await rm(root, { recursive: true, force: true }); } };
}
async function turn(client: PiProviderClient, extra: Partial<StartRunInput> = {}) {
  const ref = await client.startRun({ clientOperationId: randomUUID(), sessionId: randomUUID(),
    instructions: "Follow this deterministic test request.", input: "test", toolPolicy: "full", ...extra });
  for await (const _event of client.streamRun({ runId: ref.runId })) { /* drain */ }
  return client.getRun({ runId: ref.runId });
}

describe.skipIf(process.env.CHRONA_RUN_LIVE_PI_TESTS !== "1")("official Pi CLI with local mock (no real credentials)", () => {
  it("loads local extensions, executes their tools, and resumes owned history", async () => {
    const mock = new LLMock({ port: 0 });
    let sawLocalTool = false;
    mock.on({ hasToolResult: false }, (req) => {
      sawLocalTool = req.tools?.some((tool) => tool.function.name === "local_marker") ?? false;
      return { toolCalls: [{ name: "local_marker", arguments: "{}", id: "marker_call" }] };
    });
    mock.on({ hasToolResult: true, toolResultContains: "LOCAL_EXTENSION_EXECUTED" }, { content: "EXTENSION_OK" });
    const f = await fixture(mock);
    try {
      const before = await readFile(join(f.agent, "models.json"), "utf8");
      const first = await turn(f.client);
      expect(first.status, first.error ?? undefined).toBe("completed");
      expect(first.outputText).toContain("EXTENSION_OK");
      expect(sawLocalTool).toBe(true);
      const restarted = new PiProviderClient({ config: f.config, stateDirectory: join(f.root, "state") });
      const next = await turn(restarted, { resumeSessionRef: first.nativeSessionId });
      expect(next.status, next.error ?? undefined).toBe("completed");
      expect(next.nativeSessionId).toBe(first.nativeSessionId);
      expect(await readFile(join(f.agent, "models.json"), "utf8")).toBe(before);
    } finally { await f.close(); }
  }, 60_000);

  it("isolates consecutive compose/review sessions and terminates structured-result tools", async () => {
    const mock = new LLMock({ port: 0 });
    const catalogs: string[][] = [];
    mock.on({}, (req) => {
      catalogs.push(req.tools?.map((tool) => tool.function.name) ?? []);
      return { toolCalls: [{ name: "chrona_feature_complete", arguments: '{"result":{"ok":true}}', id: "result_call" }] };
    });
    const f = await fixture(mock);
    try {
      const sessions: string[] = [];
      for (const phase of ["compose", "review"]) {
        const result = await turn(f.client, { instructions: phase, input: "x".repeat(20_000), toolPolicy: "terminal_only", terminalToolName: "chrona_feature_complete",
          tools: [{ name: "chrona_feature_complete", description: "Submit result", inputSchema: {
            type: "object", properties: { result: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } }, required: ["result"],
          } }] });
        expect(result.status, result.error ?? undefined).toBe("completed");
        expect(result.terminalToolCall?.input).toEqual({ result: { ok: true } });
        sessions.push(result.nativeSessionId!);
      }
      expect(new Set(sessions).size).toBe(2);
      expect(catalogs).toEqual([["chrona_feature_complete"], ["chrona_feature_complete"]]);
    } finally { await f.close(); }
  }, 60_000);
});
