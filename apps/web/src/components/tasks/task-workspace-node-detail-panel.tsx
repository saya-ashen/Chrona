import type { ExecutionActionInput } from "@chrona/contracts/ai";
import { DEFAULT_GRAPH_COPY } from "@/components/task/plan/task-plan-graph/constants";
import { TaskPlanGraphInspector } from "@/components/task/plan/task-plan-graph/inspector";
import type { PlanNodeDataModel } from "@/components/task/plan/task-plan-graph/types";
import type { TaskExecutionDispatchResult } from "./task-workspace-query";
import type { NodeDetailPanelState } from "./task-workspace-types";

export function TaskWorkspaceNodeDetailPanel({
  detail,
  selectedNodes,
  onDispatchExecutionAction,
}: {
  detail: NodeDetailPanelState;
  selectedNodes: PlanNodeDataModel[];
  onDispatchExecutionAction: (action: ExecutionActionInput) => Promise<TaskExecutionDispatchResult>;
}) {
  return (
    <section id="task-workspace-node-actions" aria-label="Current node details" className="scroll-mt-4 xl:min-h-0">
      <TaskPlanGraphInspector
        node={detail.currentNode}
        graphCopy={DEFAULT_GRAPH_COPY}
        nodes={selectedNodes}
        onDispatchExecutionAction={onDispatchExecutionAction}
      />
    </section>
  );
}
