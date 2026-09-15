import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
import { supportsSafeTerminalOnlyFeatureRuntime, type ProviderRunEvent, type StartRunInput } from "@chrona/providers-foundation";
import { experimentalProviderTypes, providerCapabilityMatrix, releasedProviderTypes } from "@chrona/contracts";
import { PiProviderClient } from "./PiProviderClient";
import { PiStderrClassifier, readJsonl } from "./rpc";
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
async function nonterminalRequest(scenario: string, delayMs = 0): Promise<StartRunInput> {
  const token = "synthetic-control-token";
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (request.headers.get("authorization") !== `Bearer ${token}`) return new Response(null, { status: 401 });
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const body = await request.json() as Record<string, unknown>;
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "initialize") return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } } });
    if (body.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "chrona.context.read", description: "read", inputSchema: { type: "object" } }] } });
    if (body.method === "tools/call") {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "synthetic bounded response" }] } });
    }
    return new Response(null, { status: 400 });
  } });
  cleanups.push(async () => { await server.stop(true); });
  return request(scenario, { control: { baseUrl: `${server.url}api`, runToken: token } });
}
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

  it("classifies standard JavaScript error headers without retaining their messages", () => {
    const cases = [
      ["AggregateError", "aggregate_error"], ["EvalError", "eval_error"],
      ["RangeError", "range_error"], ["ReferenceError", "reference_error"],
      ["SyntaxError", "syntax_error"], ["TypeError", "type_error"], ["URIError", "uri_error"],
    ] as const;
    for (const [header, label] of cases) {
      const classifier = new PiStderrClassifier();
      for (const byte of Buffer.from(`${header}: synthetic-private-message\n`)) classifier.push(Buffer.from([byte]));
      classifier.finish();
      expect(classifier.summary()).toBe(`stderr_classes=${label}`);
      expect(JSON.stringify(classifier)).not.toContain("synthetic-private-message");
    }
  });

  it("classifies only bounded allowlisted stderr evidence", () => {
    const classifier = new PiStderrClassifier();
    classifier.push(Buffer.from(`synthetic-credential=not-a-secret ${String.fromCharCode(27)}[31mEP`));
    classifier.push(Buffer.from(`IPE${String.fromCharCode(27)}[0m`));
    classifier.push(Buffer.from(" " + "x".repeat(20_000) + " ENOENT"));
    classifier.finish();
    expect(classifier.summary()).toBe("stderr_classes=broken_pipe,missing_resource");
    expect(classifier.summary()).not.toContain("synthetic-credential");
    expect(JSON.stringify(classifier)).not.toContain("synthetic-credential");

    const unknown = new PiStderrClassifier();
    unknown.push("synthetic-credential=not-a-secret");
    expect(unknown.summary()).toBe("stderr_class=unknown");
    expect(JSON.stringify(unknown)).not.toContain("synthetic-credential");
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

  it("classifies Pi EOF source and bridge phase without mistaking cleanup for the original exit", async () => {
    const { client } = await fixture();
    const stdout = await collect(client, request("eof", { timeoutMs: 2000 }));
    expect(stdout.snapshot.error).toContain("Pi RPC stdout closed before completion");
    expect(stdout.snapshot.error).toContain("phase before_terminal_call");
    // The fixture stays alive until PiRun cleanup terminates it. That cleanup
    // signal is not evidence about why its stdout closed.
    expect(stdout.snapshot.error).not.toContain("SIGTERM");
    expect(stdout.snapshot.error).not.toContain("SIGKILL");

    const bridge = await collect(client, request("bridge-eof", { timeoutMs: 2000 }));
    expect(bridge.snapshot.error).toContain("Pi RPC bridge fd4 closed before completion");
    expect(bridge.snapshot.error).toContain("phase before_terminal_call");

    const acknowledged = await collect(client, request("terminal-eof", terminal));
    expect(acknowledged.snapshot.status).toBe("failed");
    expect(acknowledged.snapshot.error).toContain("Pi RPC stdout closed before completion");
    expect(acknowledged.snapshot.error).toContain("phase terminal_submission_acknowledged");

    const naturalExit = await collect(client, request("exit", { timeoutMs: 2000 }));
    expect(naturalExit.snapshot.error).toContain("Pi exited before completion (code 0, signal none)");
    expect(naturalExit.snapshot.error).toContain("phase before_terminal_call");
  });

  it("persists only fixed stderr classes on a failed Pi closure", async () => {
    const { client } = await fixture();
    const known = await collect(client, request("stderr-class", { timeoutMs: 2000 }));
    expect(known.snapshot.error).toContain("stderr_classes=broken_pipe");
    expect(known.snapshot.error).not.toContain("synthetic-credential");
    expect(known.snapshot.error).not.toContain("not-a-secret");

    const exception = await collect(client, request("stderr-type-error", { timeoutMs: 2000 }));
    expect(exception.snapshot.status).toBe("failed");
    expect(exception.snapshot.error).toContain("stderr_classes=type_error");
    expect(exception.snapshot.error).not.toContain("synthetic-credential");
    expect(exception.snapshot.error).not.toContain("not-a-secret");
    expect(exception.snapshot.error).not.toContain("synthetic-path");

    const unknown = await collect(client, request("stderr-unknown", { timeoutMs: 2000 }));
    expect(unknown.snapshot.error).toContain("stderr_class=unknown");
    expect(unknown.snapshot.error).not.toContain("synthetic-credential");
  });

  it("records bounded, correlated nonterminal bridge facts without retaining identifiers", async () => {
    const { client } = await fixture();
    const before = await collect(client, await nonterminalRequest("nonterminal-before-bridge"));
    expect(before.snapshot.error).toContain("nonterminal_tools pi_start=1,pi_end=0,bridge_call_received=0,result_produced=0,bridge_reply_written=0,correlated=0,unended=1");
    expect(before.snapshot.error).not.toContain("nonterminal-1");

    const ended = await collect(client, await nonterminalRequest("nonterminal-end"));
    expect(ended.snapshot.error).toContain("nonterminal_tools pi_start=1,pi_end=1,bridge_call_received=0,result_produced=0,bridge_reply_written=0,correlated=0,unended=0");

    const afterBridge = await collect(client, await nonterminalRequest("nonterminal-after-bridge", 100));
    expect(afterBridge.snapshot.error).toContain("nonterminal_tools pi_start=1,pi_end=0,bridge_call_received=1,result_produced=0,bridge_reply_written=0,correlated=1,unended=1");

    const afterResult = await collect(client, await nonterminalRequest("nonterminal-after-result"));
    expect(afterResult.snapshot.error).toContain("nonterminal_tools pi_start=1,pi_end=0,bridge_call_received=1,result_produced=1,bridge_reply_written=1,correlated=1,unended=1");

    const overlap = await collect(client, await nonterminalRequest("nonterminal-overlap"));
    expect(overlap.snapshot.error).toContain("nonterminal_tools pi_start=2,pi_end=0,bridge_call_received=2,result_produced=2,bridge_reply_written=2,correlated=2,unended=2");
    expect(overlap.snapshot.error).not.toContain("correlation_incomplete");
  });

  it("marks nonterminal lifecycle counts as a tracked subset after bounded correlation omissions", async () => {
    const { client } = await fixture();
    const overflow = await collect(client, await nonterminalRequest("nonterminal-overflow"));
    expect(overflow.snapshot.error).toContain("nonterminal_tools pi_start=24,pi_end=0,bridge_call_received=24,result_produced=24,bridge_reply_written=24,correlated=24,unended=24; counts_tracked_subset=true,correlation_incomplete=true");
    expect(overflow.snapshot.error).not.toContain("nonterminal-overflow-24");

    const overlong = await collect(client, await nonterminalRequest("nonterminal-overlong-id"));
    expect(overlong.snapshot.error).toContain("nonterminal_tools pi_start=0,pi_end=0,bridge_call_received=0,result_produced=0,bridge_reply_written=0,correlated=0,unended=0; counts_tracked_subset=true,correlation_incomplete=true");
    expect(JSON.stringify(overlong)).not.toContain("synthetic-secret-shaped-id");

    const missing = await collect(client, await nonterminalRequest("nonterminal-missing-id"));
    expect(missing.snapshot.error).toContain("counts_tracked_subset=true,correlation_incomplete=true");
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
