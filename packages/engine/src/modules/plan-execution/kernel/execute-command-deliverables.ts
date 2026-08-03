import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import type { ExecutionCommandEnvelope, NodeDeliverable, NodeDeliverableDeclaration } from "@chrona/contracts/ai";
import type { Prisma } from "@/generated/prisma/client";
import type { NativePlanRuntime } from "../persistence/plan-runtime-store";
import { toGraphExecutionState } from "../runtime/graph-state";
import { registerNodeDeliverables } from "../use-cases/register-generated-plan-output-artifacts";
import { isDeliverableDeclaration } from "./execute-command-graph-command";

export type PreparedSubmitNodeResultDeliverables = {
  nodeId: string;
  attemptId?: string;
  declarations: NodeDeliverableDeclaration[];
  runId?: string | null;
  sourceNodeRef?: string;
};

export function prepareSubmitNodeResultDeliverables(input: {
  runtime: NativePlanRuntime;
  session: { currentNodeId: string | null };
  command: Extract<ExecutionCommandEnvelope["command"], { type: "submit_node_result" }>;
  nodeId?: string;
  attemptId?: string;
}): PreparedSubmitNodeResultDeliverables | null {
  const { runtime, session, command } = input;
  if (command.result.kind !== "done" || !command.result.deliverables?.length) return null;
  const nodeId = input.nodeId
    ?? command.nodeId
    ?? session.currentNodeId
    ?? resolveEffectivePlanGraph(toGraphExecutionState(runtime.persisted)).nodes.find(
      (node) => node.status === "running",
    )?.id;
  if (!nodeId) throw new Error("No active node is available for deliverable registration");

  const declarations: NodeDeliverableDeclaration[] = [];
  for (const deliverable of command.result.deliverables) {
    if (!isDeliverableDeclaration(deliverable)) {
      throw new Error("Node result deliverables were already registered");
    }
    declarations.push(deliverable);
  }
  return { nodeId, attemptId: input.attemptId, declarations };
}

export async function registerPreparedSubmitNodeResultDeliverables(input: {
  runtime: NativePlanRuntime;
  mainSessionId: string;
  prepared: PreparedSubmitNodeResultDeliverables;
  runId: string | null | undefined;
  sourceNodeRef?: string;
}, tx: Prisma.TransactionClient): Promise<NodeDeliverable[]> {
  return registerNodeDeliverables({
    workspaceId: input.runtime.workspaceId,
    taskId: input.runtime.taskId,
    taskSessionId: input.mainSessionId,
    workBlockId: input.runtime.workBlockId,
    runId: input.prepared.runId ?? input.runId,
    sourceNodeId: input.prepared.nodeId,
    sourceNodeRef: input.prepared.sourceNodeRef ?? input.sourceNodeRef,
    declarations: input.prepared.declarations,
  }, tx);
}
