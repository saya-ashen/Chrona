import type { HandlingMode, ToolState, TOOL_TRANSITIONS } from "@chrona/contracts/steward";

export type HandlingSignals = {
  repeatsExpected: "once" | "few" | "recurring";
  rulesStable: boolean;
  needsOngoingObservation: boolean;
  needsUserInteraction: "none" | "read" | "compare_or_fill";
  ambiguity: "clear" | "fuzzy";
  existingToolFits: boolean;
  risk: "low" | "high";
  valueWorthKeeping: boolean;
};
export type HandlingChoice = { mode: HandlingMode; rationale: string; escalatesFrom?: HandlingMode };

/**
 * Select the lightest sufficient mode, not every lower rung in sequence.
 * Fuzzy goals require iteration; repeated comparison needs a panel; observation
 * needs a delegation. Otherwise one-off needs stay answers/results, and stable
 * repeats reuse before generating. Unstable repeats require agent iteration.
 * Selection never grants execution authority (including for an existing tool).
 */
export function chooseHandling(signals: HandlingSignals): HandlingChoice {
  const repeated = signals.repeatsExpected !== "once";
  let choice: HandlingChoice;
  if (signals.ambiguity === "fuzzy") {
    choice = { mode: "agent_iteration", escalatesFrom: "panel", rationale: "Goal is fuzzy; clarify and iterate before choosing automation." };
  } else if (repeated && signals.needsUserInteraction === "compare_or_fill") {
    choice = { mode: "panel", escalatesFrom: "delegation", rationale: "Repeated comparison or form filling needs a user-controlled panel." };
  } else if (signals.needsOngoingObservation) {
    choice = { mode: "delegation", escalatesFrom: "script", rationale: "Ongoing observation needs a scoped, pausable delegation rather than a one-off tool." };
  } else if (!repeated) {
    choice = signals.valueWorthKeeping
      ? { mode: "result_page", escalatesFrom: "direct_answer", rationale: "One-off work has durable value; keep a result page without automation." }
      : { mode: "direct_answer", rationale: "A clear one-off need can be answered directly; no durable tool is needed." };
  } else if (signals.existingToolFits) {
    choice = { mode: "reuse_tool", escalatesFrom: "result_page", rationale: "An existing tool fits repeated work; reuse it instead of generating another." };
  } else if (signals.rulesStable) {
    choice = { mode: "script", escalatesFrom: "reuse_tool", rationale: "Repeated work has stable rules and no fitting tool; a script is sufficient. Validation and authorization are required before enabling." };
  } else {
    choice = { mode: "agent_iteration", escalatesFrom: "panel", rationale: "Repeated work has unstable rules; iterate with an agent before committing to automation." };
  }
  if (signals.risk === "high") {
    choice = { ...choice, rationale: `${choice.rationale} High risk: validation and authorization are required before any tool execution.` };
  }
  return choice;
}

/** `edit` is an in-process version-change event, not an HTTP contract transition. */
export type ToolTransition = (typeof TOOL_TRANSITIONS)[number] | "edit";
export type ToolTransitionContext = {
  validationPassed?: boolean;
  validatedVersion: number | null;
  version: number;
};
export class ToolTransitionError extends Error {
  constructor(public readonly state: ToolState, public readonly transition: ToolTransition, reason: string) {
    super(`Cannot ${transition} tool in ${state}: ${reason}`);
    this.name = "ToolTransitionError";
  }
}

/**
 * Caller emits `edit` on every new version and persists the returned state with
 * cleared validation/authorization metadata. Disabled retains authorization for
 * the SAME version; retired is terminal except that editing creates a new draft.
 * No state is itself permission to run: the application still enforces scopes.
 */
export function nextToolState(state: ToolState, transition: ToolTransition, context: ToolTransitionContext): ToolState {
  const fail = (reason: string): never => { throw new ToolTransitionError(state, transition, reason); };
  if (!Number.isSafeInteger(context.version) || context.version < 1) return fail("version must be a positive integer");
  if (transition === "edit") return "generated";
  switch (transition) {
    case "validate":
      if (state !== "generated" && state !== "validation_failed") return fail("only drafts can be validated");
      if (typeof context.validationPassed !== "boolean") return fail("validation result is required");
      return context.validationPassed ? "validated" : "validation_failed";
    case "authorize":
      if (state !== "validated") return fail("successful validation is required");
      if (context.validatedVersion !== context.version) return fail("validation must match the current version");
      return "authorized";
    case "enable":
      if (state !== "authorized" && state !== "disabled") return fail("authorization is required");
      if (context.validatedVersion !== context.version) return fail("validation and authorization cannot carry across edits");
      return "enabled";
    case "disable":
      if (state !== "enabled") return fail("only an enabled tool can be disabled");
      return "disabled";
    case "retire":
      if (state !== "disabled") return fail("disable the tool before retiring it");
      return "retired";
    default:
      return fail("unknown transition");
  }
}
