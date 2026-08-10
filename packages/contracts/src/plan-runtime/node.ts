import type { WaitConfig } from "./node-core";
import type { CheckpointInputFields } from "./_leaf";
export type {
  CheckpointConfig,
  CheckpointInteraction,
  ConditionConfig,
  NodeActionForm,
  NodeActionFormField,
  NodeActionFormOption,
  NodeConfig,
  NodeDefinition,
  NodeLayerType,
  TaskConfig,
  TaskPriority,
  TaskUserInteractionExpectation,
  WaitConfig,
  WaitKind,
} from "./node-core";

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
    plan: {
      title: string;
      goal: string;
      assumptions: string[];
      summary?: string;
    };
    goal?: {
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
    acceptedGoalResults?: Array<{
      ref: string;
      taskTitle: string;
      acceptedAt?: string | null;
      summary: string;
      artifactCount: number;
    }>;
    goalAssets?: Array<{
      ref: string;
      title: string;
      description: string;
      kind: string;
      role: string;
      version: number;
      updatedAt: string;
    }>;
    run?: {
      planningPrompt?: string;
      startPrompt?: string;
      generatedFiles?: {
        directory: string;
        referenceBase: string;
      };
    };
    currentNodeInput?: {
      text?: string;
      fields?: CheckpointInputFields;
    };
    relevantPreviousResults: Array<{
      nodeRef: string;
      title: string;
      summary?: string;
      inputFields?: CheckpointInputFields;
    }>;
    globalSummary?: string;
    resultManifest: {
      sourceRevision: number;
      outcome: { title: string; summary: string };
      currentDeliverableKeys: string[];
      findingKeys: string[];
      decisionKeys: string[];
      caveatKeys: string[];
      nextActionKeys: string[];
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
