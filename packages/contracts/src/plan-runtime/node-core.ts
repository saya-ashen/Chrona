import type {
  ConditionEvaluator,
  TaskExecutor,
  TaskMode,
  ManualCompletionForm,
} from "../ai-plan-blueprint";

export type TaskPriority = "Low" | "Medium" | "High" | "Urgent";

export type TaskUserInteractionExpectation =
  | { level: "not_expected" }
  | { level: "possible"; reason: string };

export type CheckpointInteraction =
  | { schemaSource: "static" }
  | { schemaSource: "ai"; instruction: string };

export interface TaskConfig {
  expectedOutput?: string;
  completionCriteria?: string;
  completionForm?: ManualCompletionForm;
  userInteraction?: TaskUserInteractionExpectation;
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
  interaction?: CheckpointInteraction;
}

export type NodeActionFormOption = {
  value: string;
  label: string;
  description?: string;
  recommended?: boolean;
};
export type NodeActionFormField =
  | {
      kind: "text";
      name: string;
      label: string;
      description?: string;
      multiline?: boolean;
      required?: boolean;
      placeholder?: string;
      defaultValue?: string;
    }
  | {
      kind: "choice";
      name: string;
      label: string;
      description?: string;
      selection: "single" | "multiple";
      options: NodeActionFormOption[];
      required?: boolean;
      defaultValue?: string | string[];
      minSelections?: number;
      maxSelections?: number;
    }
  | {
      kind: "boolean";
      name: string;
      label: string;
      description?: string;
      required?: boolean;
      defaultValue?: boolean;
    }
  | {
      name: string;
      label: string;
      type?: "text" | "textarea" | "select";
      required?: boolean;
      options?: string[];
    };

export interface NodeActionForm {
  instructions: string;
  submitLabel?: string;
  inputFields: NodeActionFormField[];
  revision?: string;
  source?: "plan" | "runtime_ai";
  validated?: boolean;
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

export type NodeConfig =
  | TaskConfig
  | CheckpointConfig
  | ConditionConfig
  | WaitConfig;

export type NodeLayerType = "definition" | "invalidation" | "cancellation";

export type WaitKind =
  | "user_input"
  | "approval"
  | "review"
  | "replan_required"
  | "manual_completion"
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
