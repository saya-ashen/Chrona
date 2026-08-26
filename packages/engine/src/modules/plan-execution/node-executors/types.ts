import type {
  CheckpointInputFields,
  EffectivePlanNode,
  EffectivePlanGraph,
  NodeActionForm,
  NodeAttempt,
  NodeDeliverableDeclaration,
  PlanOutputState,
  PlanPatch,
  ResultContribution,
} from "@chrona/contracts/ai";
import type { ProviderRunEvent } from "@chrona/providers-foundation";

export type NodeExecutionPlanContext = {
  title: string;
  goal: string;
  assumptions: string[];
  summary?: string;
  goalContext?: {
    goal: {
      title: string;
      additionalContext?: string;
      operationalBrief?: {
        outcome: string;
        currentFocus: string;
        strategy: string;
        constraints: string[];
      };
      capturedAt?: string;
    };
    acceptedResults: Array<{
      ref: string;
      taskTitle: string;
      acceptedAt?: string | null;
      summary: string;
      artifactCount: number;
    }>;
    assets?: Array<{
      ref: string;
      label: string;
      kind: string;
      role: string;
      version: number | null;
      updatedAt: string;
      content: string;
    }>;
  };
};

export type NodeExecutionRunContext = {
  planningPrompt?: string;
  startPrompt?: string;
};

type NodeExecutionEvidence = {
  sessionId?: string;
  runId?: string;
  runtimeName?: string;
  provider?: string;
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
      inputFields?: CheckpointInputFields;
      selectedBranch?: {
        label: string;
        nextNodeId: string;
        source: "user" | "ai" | "system" | "default";
      };
      deliverables?: NodeDeliverableDeclaration[];
      findings?: ResultContribution[];
      decisions?: ResultContribution[];
      caveats?: ResultContribution[];
      nextActions?: ResultContribution[];
      resultEvidence?: Array<{
        key: string;
        summary: string;
        artifactRef?: `AF${string}`;
        sourceNodeRef: string;
      }>;
    }
  | {
      status: "waiting_for_user";
      prompt: string;
      reason: string;
      waitKind?: "user_input" | "manual_completion";
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
  executionEpoch?: number;
  executionSessionId?: string;
  workBlockId?: string | null;
  mainSession: {
    id: string;
    taskId: string;
    sessionKey: string;
  };
  node: EffectivePlanNode;
  plan: EffectivePlanGraph;
  planContext?: NodeExecutionPlanContext;
  runContext?: NodeExecutionRunContext;
  attempt: NodeAttempt;
  planOutput?: PlanOutputState;
  trigger: "manual" | "scheduler" | "system" | "auto";
  runtimeName: string;
  userInput?: string;
  inputFields?: CheckpointInputFields;
  onRuntimeEvent?: (event: ProviderRunEvent) => Promise<void> | void;
  signal?: AbortSignal;
}
