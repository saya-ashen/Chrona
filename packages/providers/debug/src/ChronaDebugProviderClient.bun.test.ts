import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { planBlueprintSchema } from "@chrona/contracts";

import { ChronaDebugProviderClient, normalizeDebugProviderProfile } from "./ChronaDebugProviderClient";

const realDebugReplayFile = process.env.CHRONA_DEBUG_REPLAY_FILE;
const realDebugProfile = process.env.CHRONA_DEBUG_PROFILE;

afterEach(() => {
  if (realDebugReplayFile === undefined) {
    delete process.env.CHRONA_DEBUG_REPLAY_FILE;
  } else {
    process.env.CHRONA_DEBUG_REPLAY_FILE = realDebugReplayFile;
  }
  if (realDebugProfile === undefined) {
    delete process.env.CHRONA_DEBUG_PROFILE;
  } else {
    process.env.CHRONA_DEBUG_PROFILE = realDebugProfile;
  }
});

const startInput = (overrides: Record<string, unknown> = {}) => ({
  clientOperationId: "debug-operation-1",
  sessionId: "debug-test-session",
  instructions: "Complete the current task node.",
  input: "Complete it.",
  stream: true,
  ...overrides,
});
describe("ChronaDebugProviderClient", () => {
  it("emits a schema-valid boundary debug plan", async () => {
    const client = new ChronaDebugProviderClient();
    const events = [];

    for await (const event of client.streamRun({
      clientOperationId: "debug-plan-stream-operation",
      sessionId: "debug-test-session",
      instructions: "Use chrona_plan_generate to create a test plan.",
      input: "Generate boundary debug plan.",
      stream: true,
    })) {
      events.push(event);
    }

    const toolCall = events.find(
      (event) => event.type === "tool_call" && event.tool === "chrona_plan_generate",
    );
    expect(toolCall).toBeDefined();

    if (!toolCall || toolCall.type !== "tool_call") {
      throw new Error("Debug provider did not emit plan tool call");
    }

    const blueprint = planBlueprintSchema.parse(toolCall?.input);
    const nodeTypes = new Set(blueprint.nodes.map((node) => node.type));
    const incoming = new Map<string, number>();

    for (const edge of blueprint.edges) {
      incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    }

    expect(blueprint.nodes).toHaveLength(10);
    expect(nodeTypes).toEqual(new Set(["task", "checkpoint", "condition", "wait"]));
    expect(blueprint.nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id).sort()).toEqual([
      "debug_collect_context",
      "debug_load_fixture",
    ]);
    expect(blueprint.nodes.some((node) => node.type === "checkpoint" && node.checkpointType === "input")).toBe(true);
    expect(blueprint.nodes.some((node) => node.type === "checkpoint" && node.checkpointType === "approve")).toBe(true);
    expect(blueprint.nodes.some((node) => node.type === "wait" && node.timeout?.onTimeout === "notify_user")).toBe(true);
    expect(blueprint.nodes.some((node) => node.type === "condition" && node.branches.length >= 2)).toBe(true);
    expect(blueprint.edges.some((edge) => edge.label === "slow wait")).toBe(true);
  });

  it("replays recorded provider events from a Hermes tape", async () => {
    const replayDir = await mkdtemp(join(tmpdir(), "chrona-debug-replay-"));
    const replayFile = join(replayDir, "run-1.jsonl");
    await writeFile(replayFile, [
      JSON.stringify({
        kind: "start",
        provider: "hermes",
        recordedAt: "2026-05-23T00:00:00.000Z",
        run: {
          provider: "hermes",
          runId: "run-1",
          sessionId: "session-1",
          status: "running",
        },
      }),
      JSON.stringify({
        kind: "event",
        provider: "hermes",
        recordedAt: "2026-05-23T00:00:01.000Z",
        event: {
          provider: "hermes",
          runId: "run-1",
          sessionId: "session-1",
          type: "text_delta",
          text: "Hi",
        },
      }),
      JSON.stringify({
        kind: "event",
        provider: "hermes",
        recordedAt: "2026-05-23T00:00:02.000Z",
        event: {
          provider: "hermes",
          runId: "run-1",
          sessionId: "session-1",
          type: "run_completed",
          run: {
            provider: "hermes",
            runId: "run-1",
            sessionId: "session-1",
            status: "completed",
          },
          outputText: "done",
        },
      }),
    ].join("\n"));
    process.env.CHRONA_DEBUG_REPLAY_FILE = replayFile;

    const client = new ChronaDebugProviderClient();
    const run = await client.startRun({
      sessionId: "ignored-session",
      instructions: "ignored",
      clientOperationId: "debug-replay-operation",
      input: "ignored",
    });
    const events = [];
    for await (const event of client.streamRun({ runId: run.runId })) {
      events.push(event);
    }
    const snapshot = await client.getRun({ runId: run.runId });

    expect(run).toMatchObject({ provider: "debug", runId: "run-1" });
    expect(events.map((event) => event.type)).toEqual(["text_delta", "run_completed"]);
    expect(events.every((event) => event.provider === "debug")).toBe(true);
    expect(snapshot).toMatchObject({
      provider: "debug",
      runId: "run-1",
      status: "completed",
      outputText: "done",
    });
    await rm(replayDir, { recursive: true, force: true });
  });

  it("normalizes configured profiles", () => {
    process.env.CHRONA_DEBUG_PROFILE = "tool-submit";

    expect(normalizeDebugProviderProfile("hermes-like")).toBe("hermes-like");
    expect(normalizeDebugProviderProfile("unknown")).toBe("deterministic");
    expect(new ChronaDebugProviderClient().profile).toBe("tool-submit");
    expect(new ChronaDebugProviderClient({ profile: "hermes-like" }).profile).toBe("hermes-like");
  });

  it("emits profile metadata for Hermes-like task execution streams", async () => {
    const client = new ChronaDebugProviderClient({ profile: "hermes-like" });
    const events = [];

    for await (const event of client.streamRun({
      clientOperationId: "debug-hermes-like-stream-operation",
      sessionId: "debug-task-session",
      instructions: "Complete the current task node.",
      input: {
        node: {
          title: "Write weather script",
        },
      },
      stream: true,
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toContain("tool_completed");
    expect(events.some(
      (event) => event.type === "text_delta" && event.text.includes("Hermes-like debug profile accepted"),
    )).toBe(true);

    const terminalEvent = events.find((event) => event.type === "run_completed");
    expect(terminalEvent).toMatchObject({
      type: "run_completed",
      raw: { debugProvider: true, profile: "hermes-like" },
      output: { text: "Hermes-like debug runtime run completed for Write weather script." },
    });
  });

  it("keeps the deterministic profile on the direct-return path", async () => {
    const client = new ChronaDebugProviderClient();
    const events = [];

    for await (const event of client.streamRun({
      clientOperationId: "debug-direct-stream-operation",
      sessionId: "debug-task-session",
      instructions: "Complete the current task node.",
      input: {
        node: {
          title: "Direct debug node",
        },
      },
      stream: true,
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).not.toContain("tool_completed");
    expect(events.some(
      (event) => event.type === "text_delta" && event.text.includes("Hermes-like debug profile accepted"),
    )).toBe(false);
  });

  it("returns a valid structured task result for finalization", async () => {
    const client = new ChronaDebugProviderClient();
    const events = [];

    for await (const event of client.streamRun({
      clientOperationId: "debug-finalization-stream-operation",
      sessionId: "debug-result-finalization",
      instructions: "Finalize the immutable ResultManifest.",
      input: { manifest: { sourceRevision: 1 } },
      structuredOutputSchema: {
        name: "chrona_finalized_result_spec",
        description: "Finalized result",
        schema: { type: "object" },
      },
      stream: true,
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      type: "run_completed",
      structuredPayload: {
        parsed: {
          root: "result",
          elements: {
            summary: { type: "ResultSummary" },
            details: { type: "RichMarkdown" },
          },
        },
      },
    });
  });
});

describe("debug operation bridge", () => {
  it("attaches the same operation to one run and finds it after start", async () => {
    const client = new ChronaDebugProviderClient();
    const first = await client.startRun(startInput());
    const second = await client.startRun(startInput());
    expect(second.runId).toBe(first.runId);
    await expect(client.findRunByClientOperationId({ clientOperationId: "debug-operation-1" })).resolves.toMatchObject({ runId: first.runId });
  });

  it("accepts an engine-managed result for a pending debug tool call", async () => {
    const client = new ChronaDebugProviderClient({ profile: "tool-submit" });
    const run = await client.startRun(startInput({ clientOperationId: "debug-tool-operation", tools: [{ name: "test_tool", inputSchema: { type: "object" } }] }));
    const events = [];
    const streaming = (async () => {
      for await (const event of client.streamRun({ runId: run.runId })) {
        events.push(event);
        if (event.type === "tool_call" && event.status === "pending") {
          await client.submitToolResult({ runId: run.runId, callId: event.callId, result: { accepted: true } });
        }
      }
    })();
    await streaming;
    expect(events.some((event) => event.type === "tool_result" && event.callId === "chrona-debug-pending-1")).toBe(true);
  });
});
