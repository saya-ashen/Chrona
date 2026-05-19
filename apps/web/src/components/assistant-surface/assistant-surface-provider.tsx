"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type {
  AiProposalPreview,
  AiSidebarPageContextSummary,
  AiSidebarQuickAction,
  AssistantActionResult,
  AssistantProposalRoute,
  AssistantQuickAction,
  AssistantSurfaceState,
  ScheduleGhostBlockPreview,
} from "@chrona/contracts";
import {
  createAssistantProposalRoute,
  normalizeAssistantAction,
  pickTopAssistantSummary,
  sortAssistantSummaries,
} from "@chrona/domain";

type AssistantSurfaceHandlers = {
  onProposal?: (route: AssistantProposalRoute) => void;
  onConfirmProposal?: (proposal: AiProposalPreview) => Promise<void> | void;
  onDismissProposal?: (proposal: AiProposalPreview) => void;
};

type AssistantSurfaceContextValue = {
  isOpen: boolean;
  input: string;
  state: AssistantSurfaceState;
  pendingProposal: AiProposalPreview | null;
  messages: string[];
  open: () => void;
  close: () => void;
  toggle: () => void;
  setInput: (input: string) => void;
  setPageContext: (context: AiSidebarPageContextSummary, actions: AiSidebarQuickAction[]) => void;
  registerHandlers: (handlers: AssistantSurfaceHandlers) => () => void;
  runQuickAction: (action: AssistantQuickAction) => void;
  submitRequest: (message: string) => void;
};

type State = {
  isOpen: boolean;
  input: string;
  surface: AssistantSurfaceState;
  pendingProposal: AiProposalPreview | null;
  messages: string[];
};

type Action =
  | { type: "open" }
  | { type: "close" }
  | { type: "toggle" }
  | { type: "set-input"; input: string }
  | { type: "set-surface"; surface: AssistantSurfaceState }
  | { type: "set-proposal"; proposal: AiProposalPreview | null }
  | { type: "add-message"; message: string };

const emptySurface: AssistantSurfaceState = {
  pageType: "unsupported",
  fingerprint: "unsupported",
  title: "Chrona AI",
  primaryObjectLabel: "Chrona",
  status: "unavailable",
  topSummary: { id: "unsupported", label: "Status", value: "No active assistant context", severity: "neutral" },
  summaries: [{ id: "unsupported", label: "Status", value: "No active assistant context", severity: "neutral" }],
  quickActions: [normalizeAssistantAction({
    id: "general-help",
    label: "Ask about this page",
    description: "Get non-mutating guidance for the current page.",
    kind: "informational",
    enabled: true,
  })],
  recentProposals: [],
  requestInputEnabled: true,
};

const initialState: State = {
  isOpen: false,
  input: "",
  surface: emptySurface,
  pendingProposal: null,
  messages: [],
};

const fallbackContext: AssistantSurfaceContextValue = {
  ...initialState,
  state: emptySurface,
  open: () => undefined,
  close: () => undefined,
  toggle: () => undefined,
  setInput: () => undefined,
  setPageContext: () => undefined,
  registerHandlers: () => () => undefined,
  runQuickAction: () => undefined,
  submitRequest: () => undefined,
};

function severityFromTone(tone?: AiSidebarPageContextSummary["highlights"][number]["tone"]) {
  if (tone === "critical") return "critical";
  if (tone === "warning") return "warning";
  if (tone === "info") return "info";
  if (tone === "success") return "success";
  return "neutral";
}

function mapPageType(type: AiSidebarPageContextSummary["type"]): AssistantSurfaceState["pageType"] {
  return type === "task" || type === "schedule" ? type : "unsupported";
}

function mapQuickAction(action: AiSidebarQuickAction): AssistantQuickAction {
  return normalizeAssistantAction({
    id: action.id,
    label: action.label,
    description: action.description,
    kind: action.kind === "mutating-preview" ? "proposal" : "informational",
    enabled: action.enabled,
    disabledReason: action.enabled ? undefined : action.disabledReason,
  });
}

function createSurfaceState(context: AiSidebarPageContextSummary, actions: AiSidebarQuickAction[]): AssistantSurfaceState {
  const summaries = sortAssistantSummaries(context.highlights.map((highlight, index) => ({
    id: `${context.type}-${index}-${highlight.label}`,
    label: highlight.label,
    value: highlight.value,
    severity: severityFromTone(highlight.tone),
  })));

  return {
    pageType: mapPageType(context.type),
    fingerprint: context.fingerprint,
    title: context.title,
    primaryObjectLabel: context.primaryObjectLabel,
    status: context.type === "unsupported" ? "unavailable" : "ready",
    topSummary: pickTopAssistantSummary(summaries),
    summaries,
    quickActions: actions.map(mapQuickAction),
    recentProposals: [],
    requestInputEnabled: true,
    unavailableReason: context.type === "unsupported" ? "This page does not expose assistant actions yet." : undefined,
  };
}

function assistantSurfaceContextSignature(surface: AssistantSurfaceState) {
  return JSON.stringify({
    pageType: surface.pageType,
    fingerprint: surface.fingerprint,
    title: surface.title,
    primaryObjectLabel: surface.primaryObjectLabel,
    status: surface.status,
    topSummary: surface.topSummary,
    summaries: surface.summaries,
    quickActions: surface.quickActions,
    requestInputEnabled: surface.requestInputEnabled,
    unavailableReason: surface.unavailableReason,
  });
}

function createSchedulePreview(selectedDate: string): ScheduleGhostBlockPreview {
  const start = new Date(`${selectedDate}T09:00:00`);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    selectedDate,
    placements: [{
      taskId: "assistant-preview",
      title: "Assistant proposal",
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      reason: "Preview only. Confirm from the schedule page.",
      confidence: 0.7,
    }],
    unplacedItems: [],
    conflictsResolved: [],
    conflictsRemaining: [],
  };
}

function createProposalPreview(surface: AssistantSurfaceState, action: AssistantQuickAction): AiProposalPreview {
  const now = new Date();
  return {
    id: `assistant-${now.getTime()}`,
    contextFingerprint: surface.fingerprint,
    createdAt: now.toISOString(),
    kind: surface.pageType === "schedule" ? "schedule" : "task",
    summary: action.label,
    affectedAreas: [action.previewSurface ?? "Assistant proposal"],
    riskLevel: "low",
    explanation: "Proposal created by the dropdown. Page preview owns confirmation.",
    confirmability: "confirmable",
    taskPreview: surface.pageType === "task" ? {
      taskId: surface.primaryObjectLabel,
      changeType: action.id === "retry-node" ? "retry-node" : action.id === "add-step" ? "add-step" : "plan-modification",
      affectedNodes: [],
      addedSteps: action.id === "add-step" ? ["Assistant suggested follow-up"] : [],
      planDiffSummary: "Preview route created. No task changes applied from dropdown.",
      requiresReview: true,
    } : null,
    schedulePreview: surface.pageType === "schedule" ? createSchedulePreview(surface.primaryObjectLabel) : null,
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "open":
      return { ...state, isOpen: true };
    case "close":
      return { ...state, isOpen: false };
    case "toggle":
      return { ...state, isOpen: !state.isOpen };
    case "set-input":
      return { ...state, input: action.input };
    case "set-surface":
      if (assistantSurfaceContextSignature(state.surface) === assistantSurfaceContextSignature(action.surface)) {
        return state;
      }
      return { ...state, surface: action.surface };
    case "set-proposal":
      return { ...state, pendingProposal: action.proposal };
    case "add-message":
      return { ...state, messages: [...state.messages, action.message] };
  }
}

const AssistantSurfaceContext = createContext<AssistantSurfaceContextValue>(fallbackContext);

export function AssistantSurfaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const open = useCallback(() => dispatch({ type: "open" }), []);
  const close = useCallback(() => dispatch({ type: "close" }), []);
  const toggle = useCallback(() => dispatch({ type: "toggle" }), []);
  const setInput = useCallback((input: string) => dispatch({ type: "set-input", input }), []);
  const setPageContext = useCallback((context: AiSidebarPageContextSummary, actions: AiSidebarQuickAction[]) => {
    dispatch({ type: "set-surface", surface: createSurfaceState(context, actions) });
  }, []);
  const registerHandlers = useCallback((_handlers: AssistantSurfaceHandlers) => () => undefined, []);
  const runQuickAction = useCallback((action: AssistantQuickAction) => {
    if (!action.enabled) return;
    if (!action.previewRequired || !action.previewSurface) {
      dispatch({ type: "add-message", message: `${action.label}: ${action.description}` });
      return;
    }
    const proposal = createProposalPreview(state.surface, action);
    const route = createAssistantProposalRoute({
      id: proposal.id,
      surface: action.previewSurface,
      label: action.label,
      baseHref: state.surface.pageType === "schedule" ? "/schedule" : "/tasks",
      createdAt: proposal.createdAt,
    });
    const result: AssistantActionResult = { kind: "proposal", message: proposal.summary, route };
    dispatch({ type: "set-proposal", proposal });
    dispatch({ type: "set-surface", surface: { ...state.surface, recentProposals: [result.route, ...state.surface.recentProposals].slice(0, 3) } });
    dispatch({ type: "add-message", message: `${result.message}: open owning page preview to confirm.` });
  }, [state.surface]);
  const submitRequest = useCallback((message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    dispatch({ type: "add-message", message: trimmed });
    dispatch({ type: "set-input", input: "" });
  }, []);

  const value = useMemo<AssistantSurfaceContextValue>(() => ({
    isOpen: state.isOpen,
    input: state.input,
    state: state.surface,
    pendingProposal: state.pendingProposal,
    messages: state.messages,
    open,
    close,
    toggle,
    setInput,
    setPageContext,
    registerHandlers,
    runQuickAction,
    submitRequest,
  }), [close, open, registerHandlers, runQuickAction, setInput, setPageContext, state, submitRequest, toggle]);

  return <AssistantSurfaceContext.Provider value={value}>{children}</AssistantSurfaceContext.Provider>;
}

export function useAssistantSurface() {
  return useContext(AssistantSurfaceContext);
}
