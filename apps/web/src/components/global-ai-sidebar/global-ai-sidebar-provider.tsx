"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type {
  AiProposalPreview,
  AiSidebarMessage,
  AiSidebarPageContextSummary,
  AiSidebarQuickAction,
  AiSidebarScheduleContextSummary,
} from "@chrona/contracts";
import { syncProposalConfirmability } from "@chrona/domain";
import { getAssistantSurfaceMessages } from "@chrona/i18n";
import { useLocale } from "@chrona/i18n/react";

type AiSidebarStatus = "idle" | "loading" | "applying" | "success" | "error" | "unavailable";

type AiSidebarState = {
  isOpen: boolean;
  context: AiSidebarPageContextSummary;
  messages: AiSidebarMessage[];
  pendingProposal: AiProposalPreview | null;
  status: AiSidebarStatus;
  errorMessage: string | null;
};

type AiSidebarHandlers = {
  onConfirmProposal?: (proposal: AiProposalPreview) => Promise<void> | void;
  onDismissProposal?: (proposal: AiProposalPreview) => void;
};

type AiSidebarContextValue = AiSidebarState & {
  actions: AiSidebarQuickAction[];
  open: () => void;
  close: () => void;
  setPageContext: (context: AiSidebarPageContextSummary, actions: AiSidebarQuickAction[]) => void;
  registerHandlers: (handlers: AiSidebarHandlers) => () => void;
  runQuickAction: (action: AiSidebarQuickAction) => void;
  submitFollowUp: (message: string) => void;
  confirmProposal: () => Promise<void>;
  dismissProposal: () => void;
  refineProposal: () => void;
};

type State = AiSidebarState & {
  actions: AiSidebarQuickAction[];
};

type Action =
  | { type: "open" }
  | { type: "close" }
  | { type: "set-context"; context: AiSidebarPageContextSummary; actions: AiSidebarQuickAction[] }
  | { type: "add-message"; message: AiSidebarMessage }
  | { type: "set-proposal"; proposal: AiProposalPreview | null }
  | { type: "set-status"; status: AiSidebarStatus; errorMessage?: string | null };

function createUnsupportedContext(locale?: string | null): AiSidebarPageContextSummary {
  const messages = getAssistantSurfaceMessages(locale);
  return {
    type: "unsupported",
    fingerprint: "unsupported",
    title: messages.generalPage,
    primaryObjectLabel: messages.primaryObjectLabel,
    highlights: [{ label: messages.modeLabel, value: messages.informationalMode }],
    capabilities: ["general-help"],
  };
}

const unsupportedContext = createUnsupportedContext();

const initialState: State = {
  isOpen: false,
  context: unsupportedContext,
  actions: [{
    id: "general-help",
    label: getAssistantSurfaceMessages().askAboutPage,
    description: getAssistantSurfaceMessages().nonMutatingGuidance,
    kind: "informational",
    enabled: true,
  }],
  messages: [],
  pendingProposal: null,
  status: "idle",
  errorMessage: null,
};

const fallbackContextValue: AiSidebarContextValue = {
  ...initialState,
  open: () => undefined,
  close: () => undefined,
  setPageContext: () => undefined,
  registerHandlers: () => () => undefined,
  runQuickAction: () => undefined,
  submitFollowUp: () => undefined,
  confirmProposal: async () => undefined,
  dismissProposal: () => undefined,
  refineProposal: () => undefined,
};

function createMessage(content: string, responseKind: AiSidebarMessage["responseKind"]): AiSidebarMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role: "assistant",
    createdAt: new Date().toISOString(),
    content,
    status: responseKind === "error" ? "error" : "complete",
    responseKind,
  };
}

function createTaskProposal(context: AiSidebarPageContextSummary, action: AiSidebarQuickAction, now: Date, locale?: string | null): AiProposalPreview {
  const messages = getAssistantSurfaceMessages(locale);
  return {
    id: `proposal-${now.getTime()}`,
    contextFingerprint: context.fingerprint,
    createdAt: now.toISOString(),
    kind: "task",
    summary: action.label,
    affectedAreas: [messages.taskPlanArea, messages.activeNodeArea],
    riskLevel: "low",
    explanation: messages.taskProposalExplanation,
    confirmability: "confirmable",
    taskPreview: {
      taskId: context.type === "task" ? context.taskId : "unsupported",
      changeType: action.id === "retry-node" ? "retry-node" : action.id === "add-step" ? "add-step" : "plan-modification",
      affectedNodes: context.type === "task" && context.activeNodeId ? [context.activeNodeId] : [],
      addedSteps: action.id === "add-step" ? [messages.guardedFollowUpStep] : [],
      planDiffSummary: messages.proposedChangesUnapplied,
      blockerChange: context.type === "task" ? context.blockReason ?? undefined : undefined,
      requiresReview: context.type === "task" ? Boolean(context.reviewState) : false,
    },
    schedulePreview: null,
  };
}

function createScheduleProposal(context: AiSidebarScheduleContextSummary, action: AiSidebarQuickAction, now: Date, locale?: string | null): AiProposalPreview {
  const messages = getAssistantSurfaceMessages(locale);
  const start = new Date(`${context.selectedDate}T09:00:00`);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return {
    id: `proposal-${now.getTime()}`,
    contextFingerprint: context.fingerprint,
    createdAt: now.toISOString(),
    kind: "schedule",
    summary: action.label,
    affectedAreas: [messages.scheduleTimelineArea, messages.unscheduledQueueArea],
    riskLevel: context.conflictCount > 0 ? "medium" : "low",
    explanation: messages.scheduleProposalExplanation,
    confirmability: "confirmable",
    taskPreview: null,
    schedulePreview: {
      selectedDate: context.selectedDate,
      placements: [{
        taskId: "preview-placement",
        title: context.unscheduledCount > 0 ? messages.nextQueuedTask : messages.focusBlock,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        reason: messages.largestOpeningReason,
        confidence: 0.72,
      }],
      unplacedItems: context.unscheduledCount > 1
        ? [{ taskId: "remaining-queue", title: messages.remainingQueue, reason: messages.needsLargerOpening }]
        : [],
      conflictsResolved: context.conflictCount > 0 ? [messages.previewResolvesConflict] : [],
      conflictsRemaining: context.conflictCount > 1 ? [messages.conflictsNeedReview] : [],
    },
  };
}

function createProposal(context: AiSidebarPageContextSummary, action: AiSidebarQuickAction, locale?: string | null): AiProposalPreview {
  const now = new Date();
  if (context.type === "schedule") return createScheduleProposal(context, action, now, locale);
  return createTaskProposal(context, action, now, locale);
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "open":
      return { ...state, isOpen: true };
    case "close":
      return { ...state, isOpen: false };
    case "set-context":
      return {
        ...state,
        context: action.context,
        actions: action.actions,
        pendingProposal: syncProposalConfirmability(state.pendingProposal, action.context),
      };
    case "add-message":
      return { ...state, messages: [...state.messages, action.message] };
    case "set-proposal":
      return { ...state, pendingProposal: action.proposal };
    case "set-status":
      return { ...state, status: action.status, errorMessage: action.errorMessage ?? null };
  }
}

const AiSidebarContext = createContext<AiSidebarContextValue>(fallbackContextValue);

export function GlobalAiSidebarProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const messages = getAssistantSurfaceMessages(locale);
  const [state, dispatch] = useReducer(reducer, initialState, (stateValue) => ({
    ...stateValue,
    context: createUnsupportedContext(locale),
    actions: [{
      id: "general-help" as const,
      label: messages.askAboutPage,
      description: messages.nonMutatingGuidance,
      kind: "informational" as const,
      enabled: true,
    }],
  }));
  const handlersRef = useRef<AiSidebarHandlers>({});

  const open = useCallback(() => dispatch({ type: "open" }), []);
  const close = useCallback(() => dispatch({ type: "close" }), []);
  const setPageContext = useCallback((context: AiSidebarPageContextSummary, actions: AiSidebarQuickAction[]) => {
    dispatch({ type: "set-context", context, actions });
  }, []);
  const registerHandlers = useCallback((handlers: AiSidebarHandlers) => {
      handlersRef.current = handlers;
      return () => {
        handlersRef.current = {};
      };
  }, []);
  const runQuickAction = useCallback((action: AiSidebarQuickAction) => {
      if (!action.enabled) return;
      if (action.kind === "informational") {
        dispatch({ type: "add-message", message: createMessage(`${action.label}: ${action.description}`, "informational") });
        dispatch({ type: "set-status", status: "success" });
        return;
      }

      const proposal = createProposal(state.context, action, locale);
      dispatch({ type: "set-proposal", proposal });
      dispatch({ type: "add-message", message: { ...createMessage(proposal.summary, "proposal"), relatedProposalId: proposal.id } });
      dispatch({ type: "set-status", status: "success" });
  }, [locale, state.context]);
  const submitFollowUp = useCallback((message: string) => {
      if (!message.trim()) return;
      dispatch({ type: "add-message", message: { ...createMessage(message.trim(), "informational"), role: "user" } });
      dispatch({ type: "add-message", message: createMessage(messages.explainOrRefine, "informational") });
  }, [messages.explainOrRefine]);
  const confirmProposal = useCallback(async () => {
      const proposal = state.pendingProposal;
      if (!proposal || proposal.confirmability !== "confirmable") return;
      dispatch({ type: "set-proposal", proposal: { ...proposal, confirmability: "applying" } });
      dispatch({ type: "set-status", status: "applying" });
      try {
        await handlersRef.current.onConfirmProposal?.(proposal);
        dispatch({ type: "set-proposal", proposal: { ...proposal, confirmability: "applied" } });
        dispatch({ type: "set-status", status: "success" });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : messages.applyFailed;
        dispatch({ type: "set-proposal", proposal: { ...proposal, confirmability: "failed" } });
        dispatch({ type: "set-status", status: "error", errorMessage });
      }
  }, [messages.applyFailed, state.pendingProposal]);
  const dismissProposal = useCallback(() => {
      if (state.pendingProposal) handlersRef.current.onDismissProposal?.(state.pendingProposal);
      dispatch({ type: "set-proposal", proposal: null });
      dispatch({ type: "set-status", status: "idle" });
  }, [state.pendingProposal]);
  const refineProposal = useCallback(() => {
      const mutatingAction = state.actions.find((action) => action.kind === "mutating-preview" && action.enabled);
      if (mutatingAction) {
        const proposal = createProposal(state.context, mutatingAction, locale);
        dispatch({ type: "set-proposal", proposal: { ...proposal, summary: messages.refinedSummary.replace("{summary}", proposal.summary) } });
      }
  }, [locale, messages.refinedSummary, state.actions, state.context]);

  const value: AiSidebarContextValue = useMemo(() => ({
    ...state,
    open,
    close,
    setPageContext,
    registerHandlers,
    runQuickAction,
    submitFollowUp,
    confirmProposal,
    dismissProposal,
    refineProposal,
  }), [close, confirmProposal, dismissProposal, open, refineProposal, registerHandlers, runQuickAction, setPageContext, state, submitFollowUp]);

  return <AiSidebarContext.Provider value={value}>{children}</AiSidebarContext.Provider>;
}

export function useGlobalAiSidebar() {
  return useContext(AiSidebarContext);
}
