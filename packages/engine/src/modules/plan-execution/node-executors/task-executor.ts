import type { EffectivePlanNode } from "@chrona/contracts/ai";
import type { NodeExecutor, NodeExecutorInput, NodeExecutionResult } from "./types";
import { decideNodeExecutionSession } from "../session-policy";
import { executeTaskNodeCapability } from "../runtime/node-ai-capabilities";
import type { AiRuntimeInvoker } from "../ai-runtime-invoker";

export class TaskNodeExecutor implements NodeExecutor {
  readonly nodeType = "task" as const;

  constructor(private readonly aiRuntimeInvoker: AiRuntimeInvoker) {}

  canExecute(node: EffectivePlanNode): boolean {
    return node.type === "task";
  }

  async execute(input: NodeExecutorInput): Promise<NodeExecutionResult> {
    const sessionDecision = decideNodeExecutionSession({
      node: input.node,
      plan: input.plan,
      parentTaskId: input.taskId,
    });

    if (input.node.status === "completed" || input.node.status === "skipped") {
      const config = input.node.config as Record<string, unknown>;
      return {
        status: "done",
        summary:
          typeof config.completionSummary === "string"
            ? config.completionSummary
            : `Node ${input.node.id} was already completed`,
        evidence: { sessionId: input.mainSession.id },
      };
    }

    switch (sessionDecision.kind) {
      case "wait_for_user":
        return {
          status: "waiting_for_user",
          prompt: `Please provide input for: ${input.node.title}`,
          reason: sessionDecision.reason,
          evidence: { sessionId: input.mainSession.id },
        };
      case "manual_only":
        return {
          status: "blocked",
          reason: sessionDecision.reason,
          evidence: { sessionId: input.mainSession.id },
        };
      case "wait_for_approval":
        return {
          status: "waiting_for_approval",
          prompt: `Please approve: ${input.node.title}`,
          reason: sessionDecision.reason,
          evidence: { sessionId: input.mainSession.id },
        };
      case "main_session":
        return executeTaskNodeCapability({
          ...input,
          aiRuntimeInvoker: this.aiRuntimeInvoker,
        });
    }
  }
}
