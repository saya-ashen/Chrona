import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
import { supportsSafeTerminalOnlyFeatureRuntime, type ProviderRunEvent, type StartRunInput } from "@chrona/providers-foundation";
import { experimentalProviderTypes, providerCapabilityMatrix, releasedProviderTypes } from "@chrona/contracts";
import { PiProviderClient } from "./PiProviderClient";
import { readJsonl } from "./rpc";
import { FAKE_PI_SOURCE } from "./fake-pi-fixture";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chrona-pi-test-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const binaryPath = join(root, "pi");
  await writeFile(binaryPath, FAKE_PI_SOURCE, { mode: 0o700 });
  const config = { binaryPath, cwd: root, codingAgentDirectory: root, timeoutMs: 5000 };
  return { client: new PiProviderClient({ config, stateDirectory: root }), config, root };
}

function request(scenario: string, extra: Partial<StartRunInput> = {}): StartRunInput {
  return { clientOperationId: randomUUID(), sessionId: randomUUID(), instructions: "Test only", input: `scenario:${scenario}`, toolPolicy: "full", ...extra };
}
const terminal = {
  toolPolicy: "terminal_only" as const,
  terminalToolName: "chrona_feature_complete",
  tools: [{ name: "chrona_feature_complete", inputSchema: { type: "object", properties: { result: { type: "object" } }, required: ["result"] } }],
};
async function collect(client: PiProviderClient, input: StartRunInput) {
  const run = await client.startRun(input);
  const events: ProviderRunEvent[] = [];
  for await (const event of client.streamRun({ runId: run.runId })) events.push(event);
  return { run, events, snapshot: await client.getRun({ runId: run.runId }) };
}

describe("Pi JSONL protocol", () => {
  it("preserves split UTF-8, U+2028 and CRLF", () => {
    const pipe = new PassThrough(); const results: unknown[] = []; const errors: Error[] = [];
    readJsonl(pipe, (event) => results.push(event), (error) => errors.push(error));
    const data = Buffer.from('{"text":"中文\u2028line"}\r\n');
    for (const byte of data) pipe.write(Buffer.from([byte]));
    pipe.end();
    expect(results).toEqual([{ text: "中文\u2028line" }]); expect(errors).toEqual([]);
  });
  it("rejects malformed output without exposing it", () => {
    const pipe = new PassThrough(); const errors: Error[] = [];
    readJsonl(pipe, () => {}, (error) => errors.push(error));
    pipe.write("PRIVATE_SECRET\n"); pipe.end();
    expect(errors[0]?.message).toBe("Pi emitted invalid or oversized JSONL");
  });
});

describe.skipIf(process.platform === "win32")("Pi provider lifecycle", () => {
  it("advertises experimental single-attempt features, never active-run recovery", async () => {
    const { client } = await fixture();
    expect(experimentalProviderTypes).toContain("pi");
    expect([...releasedProviderTypes] as string[]).not.toContain("pi");
    expect(supportsSafeTerminalOnlyFeatureRuntime(client.getCapabilities())).toBe(true);
    expect(providerCapabilityMatrix.find((entry) => entry.provider === "pi")?.recovery).toMatchObject({
      sessionResume: true, historyReplay: false, activeRunLookup: false, streamReconnect: false,
    });
    expect((await client.getRuntimeDiagnostics()).model).toBe("fixture/model");
  });

  it("streams normalized text and native session provenance", async () => {
    const { client } = await fixture(); const result = await collect(client, request("text"));
    expect(result.events[0]?.type).toBe("run_started");
    expect(result.snapshot.status).toBe("completed");
    expect(result.snapshot.outputText).toContain("中文\u2028line");
    expect(result.snapshot.nativeSessionId).toBe(result.run.nativeSessionId);
    expect(result.snapshot.usage).toMatchObject({ inputTokens: 10, outputTokens: 4 });
  });

  it("waits for agent_settled rather than agent_end before retries", async () => {
    const { client } = await fixture(); const result = await collect(client, request("retry"));
    expect(result.snapshot.outputText).toBe("after retry");
    expect(result.events.filter((event) => event.type === "run_completed")).toHaveLength(1);
  });

  it("accepts only an executed terminal tool, not assistant text", async () => {
    const { client } = await fixture();
    const result = await collect(client, request("terminal", terminal));
    expect(result.snapshot.terminalToolCall).toMatchObject({ name: "chrona_feature_complete", input: { result: { ok: true } } });
    const missing = await collect(client, request("missing", terminal));
    expect(missing.snapshot.status).toBe("failed");
    expect(missing.snapshot.error).toContain("required terminal tool");
  });

  it("rejects duplicate terminal submissions", async () => {
    const { client } = await fixture(); const result = await collect(client, request("duplicate", terminal));
    expect(result.snapshot.status).toBe("failed");
  });

  it.each(["fail", "extension-error", "input"])("fails closed for %s", async (scenario) => {
    const { client } = await fixture(); const result = await collect(client, request(scenario));
    expect(result.snapshot.status).toBe("failed");
    expect(JSON.stringify(result.events)).not.toContain("PRIVATE_SECRET");
  });

  it("requires an exact pending confirmation and rejects broader grants", async () => {
    const { client } = await fixture(); const run = await client.startRun(request("confirm"));
    let approved = false;
    for await (const event of client.streamRun({ runId: run.runId })) {
      if (event.type !== "approval_required") continue;
      expect((await client.resolveApproval({ runId: run.runId, approvalId: "wrong", choice: "approve_once" })).status).toBe("not_pending");
      await expect(client.resolveApproval({ runId: run.runId, approvalId: event.approval.id, choice: "approve_always" })).rejects.toThrow();
      expect((await client.resolveApproval({ runId: run.runId, approvalId: event.approval.id, choice: "approve_once" })).resolved).toBe(1);
      approved = true;
    }
    expect(approved).toBe(true); expect((await client.getRun({ runId: run.runId })).outputText).toBe("approved");
  });

  it("cancels an active run and bounds a hanging provider", async () => {
    const { client } = await fixture(); const run = await client.startRun(request("hang"));
    await client.cancelRun({ runId: run.runId });
    for await (const _event of client.streamRun({ runId: run.runId })) { /* drain */ }
    expect((await client.getRun({ runId: run.runId })).status).toBe("cancelled");
    expect((await collect(client, request("hang", { timeoutMs: 2000 }))).snapshot.status).toBe("failed");
  });

  it.each(["eof", "exit"])("fails promptly when Pi closes before agent_settled (%s)", async (scenario) => {
    const { client } = await fixture();
    const result = await collect(client, request(scenario, { timeoutMs: 2000 }));
    expect(result.snapshot.status).toBe("failed");
    expect(result.snapshot.error).toMatch(/closed.*completion|exited before completion/);
  });

  it("rejects clean EOF during isolated startup instead of waiting for the model timeout", async () => {
    const { client } = await fixture();
    await expect(client.startRun(request("terminal", { ...terminal, instructions: "startup-eof", timeoutMs: 2000 }))).rejects.toThrow("closed before completion");
  });

  it("aborts startup and can run compose then review with a 20KB request", async () => {
    const { client } = await fixture();
    const controller = new AbortController();
    const start = client.startRun(request("terminal", { ...terminal, instructions: "startup-hang", signal: controller.signal }));
    const timer = setTimeout(() => controller.abort(), 300);
    try { await expect(start).rejects.toThrow(); } finally { clearTimeout(timer); }
    for (const phase of ["compose", "review"]) {
      const result = await collect(client, request("terminal", { ...terminal, instructions: phase, input: "x".repeat(20_000) }));
      expect(result.snapshot.status).toBe("completed");
      expect(result.snapshot.terminalToolCall?.name).toBe("chrona_feature_complete");
    }
  });

  it("resumes only Chrona-owned sessions across client instances", async () => {
    const { client, config, root } = await fixture(); const first = await collect(client, request("text"));
    const restarted = new PiProviderClient({ config, stateDirectory: root });
    expect((await restarted.inspectConversation(first.run.nativeSessionId!)).available).toBe(true);
    const next = await collect(restarted, request("text", { resumeSessionRef: first.run.nativeSessionId }));
    expect(next.snapshot.outputText).toContain("turn 2");
    expect(next.run.nativeSessionId).toBe(first.run.nativeSessionId);
    expect((await restarted.inspectConversation("../../auth.json")).available).toBe(false);
  });

  it("never replays an operation after a restart or reports a session as an active run", async () => {
    const { client, config, root } = await fixture(); const input = request("text");
    const first = await collect(client, input);
    expect((await client.startRun(input)).runId).toBe(first.run.runId);
    await expect(client.startRun({ ...input, input: "changed" })).rejects.toThrow("different input");
    const restarted = new PiProviderClient({ config, stateDirectory: root });
    await expect(restarted.startRun(input)).rejects.toThrow("already started");
    await expect(restarted.getRun({ runId: first.run.runId })).rejects.toThrow("unavailable");
  });

  it("rejects silent model fallback and unsafe terminal control", async () => {
    const { client } = await fixture();
    await expect(client.startRun(request("text", { runtimeConfiguration: { model: "wrong/model" } }))).rejects.toThrow("different model");
    await expect(client.startRun(request("terminal", { ...terminal, terminalToolName: "chrona_node_complete", tools: [{ name: "chrona_node_complete", inputSchema: {} }] }))).rejects.toThrow("authorization");
  });

  it("rejects a second stream consumer without cancelling the first", async () => {
    const { client } = await fixture(); const run = await client.startRun(request("hang"));
    const stream = client.streamRun({ runId: run.runId })[Symbol.asyncIterator]();
    expect((await stream.next()).value?.type).toBe("run_started");
    await expect(client.streamRun({ runId: run.runId })[Symbol.asyncIterator]().next()).rejects.toThrow("one stream consumer");
    expect((await client.getRun({ runId: run.runId })).status).toBe("running");
    await stream.return?.(undefined);
    expect((await client.getRun({ runId: run.runId })).status).toBe("cancelled");
  });

  it("does not modify the Pi profile", async () => {
    const { client, root } = await fixture(); const file = join(root, "settings.json");
    await writeFile(file, '{"existing":true}'); await collect(client, request("text"));
    expect(await readFile(file, "utf8")).toBe('{"existing":true}');
  });
});
