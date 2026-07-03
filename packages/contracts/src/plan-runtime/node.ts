import type { ConditionEvaluator, TaskExecutor, TaskMode } from "../ai-plan-blueprint";

export type TaskPriority = "Low" | "Medium" | "High" | "Urgent";

export interface TaskConfig {
  expectedOutput?: string;
  completionCriteria?: string;
}

export interface CheckpointConfig {
  checkpointType: string;
  prompt: string;
  required: boolean;
  options?: string[];
  inputFields?: Array<{
    name: string;
    label: string;
    type?: string;
    required?: boolean;
    options?: string[];
  }>;
}

export interface NodeActionFormField {
  name: string;
  label: string;
  type?: "text" | "textarea" | "select";
  required?: boolean;
  options?: string[];
}

export interface NodeActionForm {
  instructions: string;
  submitLabel?: string;
  inputFields: NodeActionFormField[];
}

export interface ConditionConfig {
  condition: string;
  evaluationBy: ConditionEvaluator;
  branches: Array<{
    label: string;
    nextNodeId: string;
  }>;
  defaultNextNodeId?: string;
}

export interface WaitConfig {
  waitFor: string;
  timeout?: {
    minutes: number;
    onTimeout: string;
  };
}

export type NodeConfig = TaskConfig | CheckpointConfig | ConditionConfig | WaitConfig;

export type NodeLayerType = "definition" | "invalidation" | "cancellation";

export type WaitKind =
  | "user_input"
  | "approval"
  | "review"
  | "replan_required"
  | "manual_action"
  | "external_dependency"
  | "capability_unavailable";

export interface NodeDefinition {
  title: string;
  objective: string;
  description?: string;
  semantics: {
    type: "task" | "checkpoint" | "condition" | "wait";
    priority?: TaskPriority;
    mode?: TaskMode;
    linkedTaskId?: string;
    metadata?: Record<string, unknown>;
  };
  executor?: TaskExecutor;
  inputContract?: Record<string, unknown> | null;
  outputContract?: Record<string, unknown> | null;
  reviewRequired?: boolean;
  estimatedMinutes?: number;
  metadata?: Record<string, unknown>;
}

export type AiVisibleRefKind = "task" | "plan" | "node" | "branch";

export interface AiVisibleRefPublic {
  ref: string;
  kind: AiVisibleRefKind;
  label: string;
  version: number;
}

export interface AiVisibleRefBinding extends AiVisibleRefPublic {
  backendId: string;
  nodeId?: string;
  nodeLayerId?: string | null;
  branchKey?: string;
  nextNodeId?: string;
  nextNodeLayerId?: string | null;
  retiredAt?: string | null;
}

export interface SemanticRefHistory {
  taskRef: AiVisibleRefBinding;
  planRef: AiVisibleRefBinding;
  nodeRefs: AiVisibleRefBinding[];
  branchRefs: AiVisibleRefBinding[];
  createdAt: string;
  version: number;
}

export interface NodeRuntimeInput {
  node: {
    ref: string;
    type: "task" | "checkpoint" | "condition" | "wait";
    title: string;
    objective?: string;
    expectedOutput?: string;
    completionCriteria?: string;
    condition?: string;
    checkpoint?: {
      type: string;
      prompt: string;
      options?: string[];
    };
    wait?: {
      waitFor: string;
      timeout?: WaitConfig["timeout"];
    };
  };
  context: {
    taskTitle?: string;
    relevantPreviousResults: Array<{
      nodeRef: string;
      title: string;
      summary?: string;
    }>;
    globalSummary?: string;
    planOutput: {
      revision: number;
      hasSpec: boolean;
      root: string | null;
      rootChildren: string[];
      elementIds: string[];
      updatedAt: string | null;
      lastSummary?: string;
    };
  };
  branchOptions?: Array<{
    ref: string;
    key: string;
    label: string;
  }>;
}

export type ReviewOutcome = "accept" | "reject" | "request_changes";

export interface StepReviewInput {
  taskId: string;
  nodeId: string;
  outcome: ReviewOutcome;
  feedback?: string;
}

export interface StepReviewResponse {
  nodeId: string;
  outcome: ReviewOutcome;
  feedback: string | null;
  nextAction: string | null;
}
