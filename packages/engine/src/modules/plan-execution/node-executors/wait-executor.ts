import type { CheckpointInputFields, EffectivePlanNode, NodeActionForm, WaitConfig } from "@chrona/contracts/ai";
import type {
  NodeExecutor,
  NodeExecutorInput,
  NodeExecutionResult,
} from "./types";

export function waitActionForm(config: WaitConfig): NodeActionForm {
  return {
    instructions: `Confirm this external condition is complete before continuing: ${config.waitFor}. This pause does not automatically resume when a clock or external event fires.`,
    submitLabel: "Confirm and continue",
    inputFields: [{
      name: "confirmation",
      label: "Confirmation",
      type: "textarea",
      required: true,
    }],
  };
}

function hasMeaningfulInputFields(inputFields: CheckpointInputFields | undefined) {
  return Object.values(inputFields ?? {}).some((value) =>
    typeof value === "string"
      ? value.trim().length > 0
      : Array.isArray(value)
        ? value.some((entry) => entry.trim().length > 0)
        : value,
  );
}

export class WaitNodeExecutor implements NodeExecutor {
  readonly nodeType = "wait" as const;

  canExecute(node: EffectivePlanNode): boolean {
    return node.type === "wait";
  }

  async execute(input: NodeExecutorInput): Promise<NodeExecutionResult> {
    const config = input.node.config as WaitConfig;

    if (input.node.status === "completed" || input.node.status === "skipped") {
      return {
        status: "done",
        summary: `Wait node ${input.node.id} was already completed`,
        evidence: { sessionId: input.mainSession.id },
      };
    }

    const hasInputFields = hasMeaningfulInputFields(input.inputFields);
    // Checkpoint transitions format submitted fields into userInput for legacy
    // execution context. When fields are present, only their values authorize
    // this wait; otherwise whitespace fields could complete it via that label.
    const hasUserInput = Object.keys(input.inputFields ?? {}).length === 0 && Boolean(input.userInput?.trim());
    if (hasInputFields || hasUserInput) {
      return {
        status: "done",
        summary: `Wait condition completed: ${config.waitFor}`,
        output: {
          ...(hasInputFields ? { inputFields: input.inputFields } : {}),
          ...(hasUserInput ? { userInput: input.userInput?.trim() } : {}),
        },
        evidence: { sessionId: input.mainSession.id },
      };
    }
    return {
      status: "waiting_for_user",
      prompt: `Waiting for confirmation: ${config.waitFor}`,
      reason: `Confirm the external condition before continuing: ${config.waitFor}. This pause does not automatically resume when a clock or external event fires.`,
      evidence: { sessionId: input.mainSession.id },
      actionForm: waitActionForm(config),
    };
  }
}
