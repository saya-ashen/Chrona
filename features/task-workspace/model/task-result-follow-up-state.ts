export type ResultFollowUpMode = "ask" | "create_task";
export type ResultFollowUpSubmitStatus =
  | "loading"
  | "ready"
  | "submitting"
  | "error";

export type ResultFollowUpEntry = {
  id: string;
  requestId: string;
  acceptedRunId: string;
  intent: ResultFollowUpMode;
  status: "pending" | "completed" | "failed";
  instruction: string;
  answer?: string | null;
  answerSource?: string | null;
  contextSource?: "source_session" | "accepted_result_fallback" | null;
  sessionStrategy?: "fork_source_session" | "fresh_with_result" | null;
  createdTask?: { id: string; title: string } | null;
  cache?: {
    readInputTokens: number | null;
    creationInputTokens: number | null;
  };
  error?: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type ResultFollowUpStateResponse = {
  acceptedRunId: string;
  acceptedAt: string;
  sourceSession: {
    available: boolean;
    provider: string;
    health:
      | "fresh"
      | "moderate"
      | "high"
      | "compacted"
      | "unavailable"
      | "unknown";
    supportsFork: boolean;
    supportsResume: boolean;
  };
  entries: ResultFollowUpEntry[];
};

export type TaskResultFollowUpResponse = ResultFollowUpEntry;

export type TaskResultFollowUpViewState = {
  mode: ResultFollowUpMode;
  status: ResultFollowUpSubmitStatus;
  askDraft: string;
  createTaskDraft: string;
  state: ResultFollowUpStateResponse | null;
  error: string | null;
};

export type TaskResultFollowUpEvent =
  | { type: "load_started" }
  | { type: "load_succeeded"; state: ResultFollowUpStateResponse }
  | { type: "load_failed"; error: string }
  | { type: "mode_changed"; mode: ResultFollowUpMode }
  | { type: "draft_changed"; mode: ResultFollowUpMode; value: string }
  | { type: "submit_started" }
  | { type: "submit_succeeded"; entry: ResultFollowUpEntry }
  | { type: "submit_failed"; error: string };

export const initialTaskResultFollowUpState: TaskResultFollowUpViewState = {
  mode: "ask",
  status: "loading",
  askDraft: "",
  createTaskDraft: "",
  state: null,
  error: null,
};

export function reduceTaskResultFollowUpState(
  state: TaskResultFollowUpViewState,
  event: TaskResultFollowUpEvent,
): TaskResultFollowUpViewState {
  switch (event.type) {
    case "load_started":
      return { ...state, status: "loading", error: null };
    case "load_succeeded":
      return { ...state, status: "ready", state: event.state, error: null };
    case "load_failed":
      return { ...state, status: "error", error: event.error };
    case "mode_changed":
      return { ...state, mode: event.mode, error: null };
    case "draft_changed":
      return {
        ...state,
        status: state.status === "submitting" ? state.status : "ready",
        error: null,
        ...(event.mode === "ask"
          ? { askDraft: event.value }
          : { createTaskDraft: event.value }),
      };
    case "submit_started":
      if (state.status === "submitting") return state;
      return { ...state, status: "submitting", error: null };
    case "submit_succeeded":
      return {
        ...state,
        status: "ready",
        error: null,
        askDraft: state.mode === "ask" ? "" : state.askDraft,
        createTaskDraft:
          state.mode === "create_task" ? "" : state.createTaskDraft,
        state: state.state
          ? { ...state.state, entries: [...state.state.entries, event.entry] }
          : state.state,
      };
    case "submit_failed":
      return { ...state, status: "error", error: event.error };
  }
}
