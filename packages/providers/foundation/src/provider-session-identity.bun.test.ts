import { describe, expect, it } from "bun:test";
import {
  findRunByClientOperationInputSchema,
  providerRunEventSchema,
  providerRunRefSchema,
  providerRunSnapshotSchema,
  providerToolResultInputSchema,
  startRunInputSchema,
} from "./contracts/provider";

const logicalSessionId = "chrona:task:task-1:execute:plan-1";
const nativeSessionId = "/tmp/omp-session.jsonl";

function runRef(status: "running" | "completed" = "running") {
  return {
    provider: "omp",
    runId: "omp-sdk-run-1",
    sessionId: logicalSessionId,
    nativeSessionId,
    status,
  };
}

function eventRef() {
  const { status: _status, ...metadata } = runRef();
  return metadata;
}

describe("provider native session references", () => {
  it("keeps logical stream identity separate from the provider-native resume ref", () => {
    expect(providerRunRefSchema.parse(runRef())).toMatchObject({
      sessionId: logicalSessionId,
      nativeSessionId,
    });

    expect(providerRunEventSchema.parse({
      ...eventRef(),
      sequence: 1,
      type: "run_completed",
      run: runRef("completed"),
      outputText: "ok",
    })).toMatchObject({
      sessionId: logicalSessionId,
      nativeSessionId,
      run: {
        sessionId: logicalSessionId,
        nativeSessionId,
      },
    });

    expect(providerRunSnapshotSchema.parse({
      ...runRef("completed"),
      outputText: "ok",
    })).toMatchObject({
      sessionId: logicalSessionId,
      nativeSessionId,
    });
  });
});

describe("provider operation contracts", () => {
  it("requires a stable client operation id and preserves a provider resume ref", () => {
    expect(() => startRunInputSchema.parse({
      sessionId: logicalSessionId,
      instructions: "continue",
      input: "hello",
    })).toThrow();

    expect(startRunInputSchema.parse({
      clientOperationId: "operation-1",
      sessionId: logicalSessionId,
      instructions: "continue",
      input: "hello",
    }).clientOperationId).toBe("operation-1");

    expect(providerRunRefSchema.parse({
      ...runRef(),
      providerResumeRef: "native-resume-1",
    }).providerResumeRef).toBe("native-resume-1");
  });

  it("validates operation lookup and exactly one submitted tool outcome", () => {
    expect(findRunByClientOperationInputSchema.parse({ clientOperationId: "operation-1" })).toEqual({ clientOperationId: "operation-1" });
    expect(providerToolResultInputSchema.parse({ runId: "run-1", callId: "call-1", result: { ok: true } })).toMatchObject({ runId: "run-1", callId: "call-1" });
    expect(() => providerToolResultInputSchema.parse({ runId: "run-1", callId: "call-1" })).toThrow();
    expect(() => providerToolResultInputSchema.parse({ runId: "run-1", callId: "call-1", result: {}, error: { code: "x", message: "x" } })).toThrow();
  });
});
