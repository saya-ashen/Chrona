import type { LayerSource, NodeConfig, PlanNodeType, TaskExecutionMode, TaskExecutor } from "./graph";
import type { NodeResult, NodeRuntimeState } from "./runtime";

export type StructuralOperation =
  | {
      op: "add_node";
      nodeId: string;
      localId: string;
      type: PlanNodeType;
      title: string;
      config: NodeConfig;
      executor?: TaskExecutor;
      mode?: TaskExecutionMode;
      estimatedMinutes?: number;
    }
  | {
      op: "update_node";
      nodeId: string;
      patch: Partial<{
        title: string;
        type: PlanNodeType;
        config: NodeConfig;
        executor: TaskExecutor;
        mode: TaskExecutionMode;
        estimatedMinutes: number;
      }>;
    }
  | { op: "delete_node"; nodeId: string }
  | { op: "add_edge"; from: string; to: string; label?: string }
  | { op: "delete_edge"; from: string; to: string }
  | {
      op: "replace_subgraph";
      removeNodeIds: string[];
      addNodes: Array<{
        nodeId: string;
        localId: string;
        type: PlanNodeType;
        title: string;
        config: NodeConfig;
        executor?: TaskExecutor;
        mode?: TaskExecutionMode;
        estimatedMinutes?: number;
      }>;
      addEdges: Array<{ from: string; to: string; label?: string }>;
    };

export interface StructuralLayer {
  layerId: string;
  planId: string;
  type: "structural";
  version: number;
  source: LayerSource;
  active: boolean;
  timestamp: string;
  rationale?: string;
  operations: StructuralOperation[];
}

export interface RuntimeLayer {
  layerId: string;
  planId: string;
  type: "runtime";
  version: number;
  active: boolean;
  timestamp: string;
  source?: LayerSource;
  nodeStates: Record<
    string,
    Pick<NodeRuntimeState, "status"> &
      Partial<Pick<NodeRuntimeState, "attempts" | "linkedTaskId" | "lastError" | "startedAt" | "completedAt">>
  >;
}

export interface ResultLayer {
  layerId: string;
  planId: string;
  type: "result";
  version: number;
  active: boolean;
  timestamp: string;
  source?: LayerSource;
  nodeResults: Record<string, NodeResult>;
}
