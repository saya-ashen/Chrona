import type { EffectivePlanNode, WaitConfig } from "@chrona/contracts/ai";
import type {
  NodeExecutor,
  NodeExecutorInput,
  NodeExecutionResult,
} from "./types";

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

    const hasInputFields = Boolean(
      input.inputFields && Object.keys(input.inputFields).length > 0,
    );
    const hasUserInput = Boolean(input.userInput?.trim());
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
    if (config.timeout?.onTimeout === "continue") {
      return {
        status: "done",
        summary: `Wait condition noted: ${config.waitFor}`,
        evidence: { sessionId: input.mainSession.id },
      };
    }

    return {
      status: "waiting_for_user",
      prompt: `Waiting for: ${config.waitFor}`,
      reason: `Wait node ${input.node.id} requires external completion`,
      evidence: { sessionId: input.mainSession.id },
    };
  }
}
