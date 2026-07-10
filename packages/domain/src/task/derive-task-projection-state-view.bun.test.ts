import { describe, expect, it } from "bun:test";
import { deriveTaskProjectionStateView, hasTerminalAuthoritativeTaskState } from "./derive-task-projection-state-view";

describe("deriveTaskProjectionStateView", () => {
  it("treats failed latest provider run as diagnostic after completed projection", () => {
    const view = deriveTaskProjectionStateView({
      persistedStatus: "Completed",
      displayState: null,
      latestRunStatus: "Failed",
    });

    expect(view.state).toBe("result_ready");
    expect(view.label).toBe("Result ready");
    expect(view.source.providerStatus).toBe("Failed");
  });

  it("keeps failed latest provider run actionable when task has no terminal state", () => {
    const view = deriveTaskProjectionStateView({
      persistedStatus: "Running",
      displayState: null,
      latestRunStatus: "Failed",
    });

    expect(view.state).toBe("failed");
    expect(view.label).toBe("Failed");
  });

  it("detects only authoritative terminal task state", () => {
    expect(hasTerminalAuthoritativeTaskState({ taskStatus: "Completed", persistedStatus: null, displayState: null })).toBe(true);
    expect(hasTerminalAuthoritativeTaskState({ taskStatus: "Running", persistedStatus: null, displayState: null })).toBe(false);
  });
});
