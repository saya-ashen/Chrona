import type { EffectivePlanNode } from "@chrona/contracts/ai";
import type { NodeExecutor, NodeExecutorInput, NodeExecutionResult } from "./types";
import { decideNodeExecutionSession } from "../session-policy";
import { executePlanNode } from "../node-executor";

export class ConditionNodeExecutor implements NodeExecutor {
  readonly nodeType = "condition" as const;

  canExecute(node: EffectivePlanNode): boolean {
    return node.type === "condition";
  }

  async execute(input: NodeExecutorInput): Promise<NodeExecutionResult> {
    const sessionDecision = decideNodeExecutionSession({
      node: input.node,
      plan: input.plan,
      parentTaskId: input.taskId,
    });

    return executePlanNode({
      taskId: input.taskId,
      planId: input.planId,
      mainSession: input.mainSession,
      node: input.node,
      plan: input.plan,
      sessionDecision,
      trigger: input.trigger,
      runtimeName: input.runtimeName,
    });
  }
}
