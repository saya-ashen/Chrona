import { describe, expect, it } from "bun:test";
import type { ProviderRunEvent, StartRunInput } from "@chrona/providers-foundation";

import {
  CodexProviderClient,
  type CodexRunHandle,
  type CodexRunner,
} from "./CodexProviderClient";

function baseInput(overrides: Partial<StartRunInput> = {}): StartRunInput {
  return {
    sessionId: "codex-session-1",
    instructions: "Finish node.",
    input: "Return success.",
    stream: true,
    ...overrides,
  };
}

function fakeThread(id: string | null) {
  return { id } as CodexRunHandle["thread"];
}

function makeHandle(input: StartRunInput, events: ProviderRunEvent[]): CodexRunHandle {
  const runId = "codex-run-1";
  return {
    ref: {
      provider: "codex",
      runId,
      nativeRunId: runId,
      providerRunId: runId,
      sessionId: input.sessionId ?? "codex-session-1",
      status: "running",
      stream: { supported: true, reconnectable: false },
    },
    input,
    abort: new AbortController(),
    events: (async function* () {})(),
    thread: fakeThread(input.sessionId ?? "codex-session-1"),
    outputText: "done",
    usage: null,
    status: "running",
    sequence: 0,
    testEvents: events,
  } as CodexRunHandle & { testEvents: ProviderRunEvent[] };
}

function makeRunner(events: ProviderRunEvent[]): CodexRunner {
  const handles = new Map<string, CodexRunHandle & { testEvents: ProviderRunEvent[] }>();
  return {
    async start(input) {
      const handle = makeHandle(input, events) as CodexRunHandle & { testEvents: ProviderRunEvent[] };
      handles.set(handle.ref.runId, handle);
      return handle;
    },
    async *stream(handle) {
      const typed = handle as CodexRunHandle & { testEvents: ProviderRunEvent[] };
      for (const event of typed.testEvents) yield event;
      handle.status = "completed";
    },
    async snapshot(handle) {
      return {
        provider: "codex",
        runId: handle.ref.runId,
        nativeRunId: handle.ref.nativeRunId,
        sessionId: handle.thread.id ?? handle.ref.sessionId,
        status: handle.status ?? "running",
        outputText: handle.outputText,
        error: handle.error ?? null,
      };
    },
    async cancel(handle) {
      handle.status = "cancelled";
    },
  };
}

describe("CodexProviderClient", () => {
  it("exposes execution provider capabilities", async () => {
    const client = new CodexProviderClient({ runner: makeRunner([]) });

    await expect(client.checkHealth()).resolves.toMatchObject({
      provider: "codex",
      ok: true,
    });
    expect(client.getCapabilities()).toMatchObject({
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: true,
      supportsCancellation: true,
      supportsToolCalls: true,
    });
  });

  it("streams existing Codex runs and preserves real tool completion events", async () => {
    const terminalTool = "chrona_node_complete";
    const events: ProviderRunEvent[] = [
      {
        type: "run_started",
        provider: "codex",
        runId: "codex-run-1",
        sessionId: "codex-session-1",
        run: { provider: "codex", runId: "codex-run-1", sessionId: "codex-session-1", status: "running" },
      },
      {
        type: "tool_call",
        provider: "codex",
        runId: "codex-run-1",
        sessionId: "codex-session-1",
        tool: terminalTool,
        callId: "call-1",
        input: { ok: true },
        status: "completed",
      },
      {
        type: "tool_completed",
        provider: "codex",
        runId: "codex-run-1",
        sessionId: "codex-session-1",
        toolName: terminalTool,
      },
      {
        type: "run_completed",
        provider: "codex",
        runId: "codex-run-1",
        sessionId: "codex-session-1",
        run: { provider: "codex", runId: "codex-run-1", sessionId: "codex-session-1", status: "completed" },
        outputText: "done",
      },
    ];
    const client = new CodexProviderClient({ runner: makeRunner(events) });
    const run = await client.startRun(baseInput({ terminalToolName: terminalTool }));
    const streamed = [];

    for await (const event of client.streamRun({ runId: run.runId })) streamed.push(event);

    expect(streamed.map((event) => event.type)).toEqual([
      "run_started",
      "tool_call",
      "tool_completed",
      "run_completed",
    ]);
    expect(streamed.some((event) => event.type === "tool_completed" && event.toolName === terminalTool)).toBe(true);
  });

  it("cancels known runs through the runner", async () => {
    const client = new CodexProviderClient({ runner: makeRunner([]) });
    const run = await client.startRun(baseInput());

    await expect(client.cancelRun({ runId: run.runId })).resolves.toMatchObject({
      provider: "codex",
      status: "cancelled",
    });
  });
});
