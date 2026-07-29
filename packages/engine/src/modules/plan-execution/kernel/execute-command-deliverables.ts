import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import type { ExecutionCommandEnvelope, NodeDeliverableDeclaration } from "@chrona/contracts/ai";
import type { NativePlanRuntime } from "../persistence/plan-runtime-store";
import { toGraphExecutionState } from "../runtime/graph-state";
import { registerNodeDeliverables } from "../use-cases/register-generated-plan-output-artifacts";
import { isDeliverableDeclaration } from "./execute-command-graph-command";

export async function registerSubmitNodeResultDeliverables(input: {
  runtime: NativePlanRuntime;
  session: { currentNodeId: string | null };
  command: Extract<ExecutionCommandEnvelope["command"], { type: "submit_node_result" }>;
}) {
  const { runtime, session, command } = input;
  if (command.result.kind !== "done" || !command.result.deliverables?.length) return;
  const nodeId = command.nodeId
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
  command.result.deliverables = await registerNodeDeliverables({
    workspaceId: runtime.workspaceId,
    taskId: runtime.taskId,
    runId: undefined,
    sourceNodeId: nodeId,
    declarations,
  });
}
