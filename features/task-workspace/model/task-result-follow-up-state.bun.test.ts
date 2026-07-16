import { describe, expect, it } from "bun:test";
import {
  initialTaskResultFollowUpState,
  reduceTaskResultFollowUpState,
  type ResultFollowUpStateResponse,
} from "./task-result-follow-up-state";

const loadedState: ResultFollowUpStateResponse = {
  acceptedRunId: "run-1",
  acceptedAt: "2026-07-16T00:00:00.000Z",
  sourceSession: {
    available: true,
    provider: "claude_code",
    health: "fresh",
    supportsFork: true,
    supportsResume: true,
  },
  entries: [],
};

describe("task result follow-up state", () => {
  it("loads into ask mode by default", () => {
    const state = reduceTaskResultFollowUpState(initialTaskResultFollowUpState, {
      type: "load_succeeded",
      state: loadedState,
    });
    expect(state).toMatchObject({ mode: "ask", status: "ready", state: loadedState });
  });

  it("preserves independent drafts while switching modes", () => {
    let state = reduceTaskResultFollowUpState(initialTaskResultFollowUpState, {
      type: "load_succeeded",
      state: loadedState,
    });
    state = reduceTaskResultFollowUpState(state, {
      type: "draft_changed",
      mode: "ask",
      value: "Why this result?",
    });
    state = reduceTaskResultFollowUpState(state, {
      type: "mode_changed",
      mode: "create_task",
    });
    state = reduceTaskResultFollowUpState(state, {
      type: "draft_changed",
      mode: "create_task",
      value: "Implement the recommendation",
    });
    expect(state.askDraft).toBe("Why this result?");
    expect(state.createTaskDraft).toBe("Implement the recommendation");
  });

  it("appends a successful answer and clears only the active draft", () => {
    let state: typeof initialTaskResultFollowUpState = {
      ...initialTaskResultFollowUpState,
      status: "submitting",
      askDraft: "Why?",
      createTaskDraft: "Next task",
      state: loadedState,
    };
    state = reduceTaskResultFollowUpState(state, {
      type: "submit_succeeded",
      entry: {
        id: "entry-1",
        requestId: "request-1",
        acceptedRunId: "run-1",
        intent: "ask",
        status: "completed",
        instruction: "Why?",
        answer: "Because…",
        createdAt: "2026-07-16T00:01:00.000Z",
        completedAt: "2026-07-16T00:01:01.000Z",
      },
    });
    expect(state.askDraft).toBe("");
    expect(state.createTaskDraft).toBe("Next task");
    expect(state.state?.entries).toHaveLength(1);
  });

  it("keeps the draft when submission fails", () => {
    const state = reduceTaskResultFollowUpState(
      { ...initialTaskResultFollowUpState, askDraft: "Retry me", status: "submitting" },
      { type: "submit_failed", error: "Provider unavailable" },
    );
    expect(state).toMatchObject({
      status: "error",
      askDraft: "Retry me",
      error: "Provider unavailable",
    });
  });
});
