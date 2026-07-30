import { describe, expect, it } from "bun:test";
import {
  providerRunEventSchema,
  providerRunRefSchema,
  providerRunSnapshotSchema,
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
