import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ChronaDebugProviderClient, normalizeDebugProviderProfile } from "./ChronaDebugProviderClient";

const realDebugReplayFile = process.env.CHRONA_DEBUG_REPLAY_FILE;
const realDebugProfile = process.env.CHRONA_DEBUG_PROFILE;

afterEach(() => {
  if (realDebugReplayFile === undefined) delete process.env.CHRONA_DEBUG_REPLAY_FILE;
  else process.env.CHRONA_DEBUG_REPLAY_FILE = realDebugReplayFile;
  if (realDebugProfile === undefined) delete process.env.CHRONA_DEBUG_PROFILE;
  else process.env.CHRONA_DEBUG_PROFILE = realDebugProfile;
});

describe("ChronaDebugProviderClient", () => {
  it("advertises local lifecycle capabilities and creates sessions", async () => {
    const client = new ChronaDebugProviderClient();

    await expect(client.getCapabilities()).resolves.toMatchObject({
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: true,
      supportsCancellation: true,
      supportsToolCalls: true,
      startIdempotency: "client_operation_id",
    });
    await expect(client.checkHealth()).resolves.toMatchObject({ provider: "debug", ok: true, status: "ok" });
    await expect(client.createSession({ sessionKey: "generic-session" })).resolves.toMatchObject({
      provider: "debug",
      sessionId: "generic-session",
      state: "virtual",
    });
  });

  it("attaches a repeated operation to its original run and looks it up", async () => {
    const client = new ChronaDebugProviderClient();
    const input = {
      clientOperationId: "attach-operation",
      sessionId: "attach-session",
      instructions: "Produce a response.",
      input: { request: "value" },
      stream: true,
    };
    const first = await client.startRun(input);
    const second = await client.startRun(input);

    expect(second.runId).toBe(first.runId);
    await expect(client.findRunByClientOperationId({ clientOperationId: input.clientOperationId })).resolves.toMatchObject({ runId: first.runId });
  });

  it("synthesizes bounded generic structured values from schema hints", async () => {
    const client = new ChronaDebugProviderClient();
    const events = [];

    for await (const event of client.streamRun({
      clientOperationId: "schema-operation",
      sessionId: "schema-session",
      instructions: "Return structured data.",
      input: {},
      structuredOutputSchema: {
        name: "generic-output",
        description: "A generic record.",
        schema: {
          type: "object",
          required: ["example", "fallback", "constant", "choice", "items", "enabled", "empty"],
          properties: {
            example: { type: "string", examples: ["sample-value"] },
            fallback: { type: "number", default: 7 },
            constant: { const: "fixed-value" },
            choice: { oneOf: [{ type: "object", required: ["nested"], properties: { nested: { type: "string" } } }, { type: "boolean" }] },
            items: { type: "array", minItems: 2, items: { type: "integer" } },
            enabled: { type: "boolean" },
            empty: { type: "null" },
          },
        },
      },
      stream: true,
    })) events.push(event);

    expect(events.at(-1)).toMatchObject({
      type: "run_completed",
      structuredPayload: {
        parsed: {
          example: "sample-value",
          fallback: 7,
          constant: "fixed-value",
          choice: false,
          items: [0, 0],
          enabled: false,
          empty: null,
        },
      },
    });
  });

  it("uses the declared terminal tool and its synthesized input", async () => {
    const client = new ChronaDebugProviderClient();
    const events = [];

    for await (const event of client.streamRun({
      clientOperationId: "terminal-operation",
      sessionId: "terminal-session",
      instructions: "Invoke the selected action.",
      input: {},
      terminalToolName: "record_value",
      tools: [{
        name: "record_value",
        inputSchema: {
          type: "object",
          required: ["label", "count"],
          properties: {
            label: { type: "string", default: "stored" },
            count: { type: "integer" },
          },
        },
      }],
      stream: true,
    })) events.push(event);

    const call = events.find((event) => event.type === "tool_call" && event.status === "completed");
    const result = events.find((event) => event.type === "tool_result");
    expect(call).toMatchObject({ tool: "record_value", input: { label: "stored", count: 0 } });
    expect(result).toMatchObject({ tool: "record_value", result: { label: "stored", count: 0 } });
    expect(events.at(-1)).toMatchObject({ type: "run_completed", structuredPayload: undefined });
  });

  it("pauses for the first declared tool, accepts an error, and resumes", async () => {
    const client = new ChronaDebugProviderClient({ profile: "tool-submit" });
    const run = await client.startRun({
      clientOperationId: "submit-operation",
      sessionId: "submit-session",
      instructions: "Wait for an external result.",
      input: {},
      tools: [{
        name: "first_action",
        inputSchema: {
          type: "object",
          required: ["mode", "flags"],
          properties: {
            mode: { enum: ["safe", "fast"] },
            flags: { type: "array", minItems: 1, items: { type: "boolean" } },
          },
        },
      }, { name: "second_action", inputSchema: { type: "object" } }],
      stream: true,
    });
    const events = [];
    for await (const event of client.streamRun({ runId: run.runId })) events.push(event);
    const pending = events.find((event) => event.type === "tool_call" && event.status === "pending");
    if (!pending || pending.type !== "tool_call") throw new Error("Debug provider did not pause for a result.");

    expect(pending).toMatchObject({ tool: "first_action", input: { mode: "safe", flags: [false] } });
    await expect(client.submitToolResult({
      runId: run.runId,
      callId: pending.callId,
      error: { code: "external_failure", message: "The external action failed." },
    })).resolves.toEqual({ code: "accepted" });
    for await (const event of client.streamRun({ runId: run.runId })) events.push(event);

    expect(events).toContainEqual(expect.objectContaining({
      type: "tool_result",
      callId: pending.callId,
      result: { error: { code: "external_failure", message: "The external action failed." } },
    }));
    expect(events.at(-1)).toMatchObject({ type: "run_completed" });
  });

  it("returns terminal cancellation snapshots and errors for unknown runs", async () => {
    const client = new ChronaDebugProviderClient({ profile: "tool-submit" });
    const run = await client.startRun({
      clientOperationId: "cancel-operation",
      sessionId: "cancel-session",
      instructions: "Wait for cancellation.",
      input: {},
      tools: [{ name: "hold", inputSchema: { type: "object" } }],
    });

    await expect(client.cancelRun({ runId: run.runId })).resolves.toMatchObject({ status: "cancelled" });
    await expect(client.getRun({ runId: run.runId })).resolves.toMatchObject({ status: "cancelled" });
    await expect(client.cancelRun({ runId: "unknown-run" })).rejects.toThrow('unknown debug runId "unknown-run"');
    await expect(client.submitToolResult({ runId: run.runId, callId: "missing", result: null })).resolves.toEqual({ code: "not_pending" });
  });

  it("replays recorded provider events with the debug provider identity", async () => {
    const replayDir = await mkdtemp(join(tmpdir(), "debug-replay-"));
    const replayFile = join(replayDir, "run-1.jsonl");
    await writeFile(replayFile, [
      JSON.stringify({ kind: "start", provider: "recorded", recordedAt: "2026-05-23T00:00:00.000Z", run: { provider: "recorded", runId: "run-1", sessionId: "session-1", status: "running" } }),
      JSON.stringify({ kind: "event", provider: "recorded", recordedAt: "2026-05-23T00:00:01.000Z", event: { provider: "recorded", runId: "run-1", sessionId: "session-1", type: "text_delta", text: "recorded text" } }),
      JSON.stringify({ kind: "event", provider: "recorded", recordedAt: "2026-05-23T00:00:02.000Z", event: { provider: "recorded", runId: "run-1", sessionId: "session-1", type: "run_completed", run: { provider: "recorded", runId: "run-1", sessionId: "session-1", status: "completed" }, outputText: "recorded completion" } }),
    ].join("\n"));
    process.env.CHRONA_DEBUG_REPLAY_FILE = replayFile;

    const client = new ChronaDebugProviderClient();
    const run = await client.startRun({ clientOperationId: "replay-operation", sessionId: "ignored-session", instructions: "Ignored.", input: {} });
    const events = [];
    for await (const event of client.streamRun({ runId: run.runId })) events.push(event);

    expect(events.map((event) => event.type)).toEqual(["text_delta", "run_completed"]);
    expect(events.every((event) => event.provider === "debug")).toBe(true);
    await expect(client.getRun({ runId: run.runId })).resolves.toMatchObject({ status: "completed", outputText: "recorded completion" });
    await rm(replayDir, { recursive: true, force: true });
  });

  it("emits monotonically increasing sequence values", async () => {
    const client = new ChronaDebugProviderClient();
    const events = [];
    for await (const event of client.streamRun({
      clientOperationId: "sequence-operation",
      sessionId: "sequence-session",
      instructions: "Return a response.",
      input: {},
      stream: true,
    })) events.push(event);

    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
  });

  it("normalizes configured profiles", () => {
    process.env.CHRONA_DEBUG_PROFILE = "tool-submit";

    expect(normalizeDebugProviderProfile("hermes-like")).toBe("hermes-like");
    expect(normalizeDebugProviderProfile("unknown")).toBe("deterministic");
    expect(new ChronaDebugProviderClient().profile).toBe("tool-submit");
  });
});
