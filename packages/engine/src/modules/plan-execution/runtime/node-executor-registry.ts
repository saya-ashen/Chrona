import { AiRuntimeInvoker } from "../ai-runtime-invoker";
import { CheckpointNodeExecutor } from "../node-executors/checkpoint-executor";
import { ConditionNodeExecutor } from "../node-executors/condition-executor";
import { TaskNodeExecutor } from "../node-executors/task-executor";
import type { NodeExecutor } from "../node-executors/types";
import { WaitNodeExecutor } from "../node-executors/wait-executor";

export function createNodeExecutors(input: {
  aiRuntimeInvoker: AiRuntimeInvoker;
}): NodeExecutor[] {
  return [
    new TaskNodeExecutor(input.aiRuntimeInvoker),
    new CheckpointNodeExecutor(input.aiRuntimeInvoker),
    new ConditionNodeExecutor(input.aiRuntimeInvoker),
    new WaitNodeExecutor(),
  ];
}

export const planExecutionNodeExecutors = createNodeExecutors({
  aiRuntimeInvoker: new AiRuntimeInvoker(),
});
