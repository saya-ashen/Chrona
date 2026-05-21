import type {
  EffectivePlanNode,
  EffectivePlanGraph,
  NodeActionForm,
  PlanPatch,
} from "@chrona/contracts/ai";
import type { ProviderRunEvent } from "@chrona/providers-foundation";

type NodeExecutionEvidence = {
  sessionId?: string;
  runId?: string;
  runtimeName?: string;
  runtimeRunRef?: string | null;
  artifactIds?: string[];
  conversationEntryIds?: string[];
  eventIds?: string[];
};

export type NodeExecutionResult =
  | {
      status: "started";
      summary: string;
      evidence: NodeExecutionEvidence;
      output?: unknown;
    }
  | {
      status: "done";
      summary: string;
      evidence: NodeExecutionEvidence;
      output?: unknown;
      inputFields?: Record<string, string>;
      selectedBranch?: {
        label: string;
        nextNodeId: string;
        source: "user" | "ai" | "system" | "default";
      };
    }
  | {
      status: "waiting_for_user";
      prompt: string;
      reason: string;
      evidence?: NodeExecutionEvidence;
      actionForm?: NodeActionForm;
    }
  | {
      status: "waiting_for_approval";
      prompt: string;
      reason: string;
      evidence?: NodeExecutionEvidence;
    }
  | { status: "blocked"; reason: string; evidence?: NodeExecutionEvidence }
  | {
      status: "replan_required";
      reason: string;
      evidence?: NodeExecutionEvidence;
      proposedPatch?: PlanPatch;
    }
  | {
      status: "failed";
      error: string;
      evidence?: NodeExecutionEvidence;
      details?: Record<string, unknown>;
    };

export interface NodeExecutor {
  readonly nodeType: "task" | "checkpoint" | "condition" | "wait";
  canExecute(node: EffectivePlanNode): boolean;
  execute(input: NodeExecutorInput): Promise<NodeExecutionResult>;
}

export interface NodeExecutorInput {
  taskId: string;
  planId: string;
  mainSession: {
    id: string;
    taskId: string;
    sessionKey: string;
  };
  node: EffectivePlanNode;
  plan: EffectivePlanGraph;
  trigger: "manual" | "scheduler" | "system" | "auto";
  runtimeName: string;
  userInput?: string;
  inputFields?: Record<string, string>;
  onRuntimeEvent?: (event: ProviderRunEvent) => Promise<void> | void;
}
