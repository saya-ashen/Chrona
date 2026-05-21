import type { EffectivePlanNode } from "../types";
import type { GraphNodeExecutor } from "../execution/types";
import type { GraphRuntimeOptions } from "../commands/types";

function getExecutorName(node: EffectivePlanNode): string | undefined {
  const metadataName = node.definition.metadata?.executorName;
  if (typeof metadataName === "string") return metadataName;
  if (node.executor) return node.executor;
  return node.type;
}

export function createRegistryExecutor<TContext>(
  options: GraphRuntimeOptions<TContext>,
): GraphNodeExecutor<TContext> {
  return async (input) => {
    const executorName = getExecutorName(input.node);
    const executor = executorName
      ? options.executors?.[executorName]
      : undefined;
    if (executor) return executor(input);
    return options.callbacks?.executeNode?.(input) ?? null;
  };
}
