export type { StructuredSuggestion } from "./hooks/ai/types";

// AI plan contracts
export type {
  AIPlanNode,
  AIPlanNodeType,
  AITaskNode,
  AICheckpointNode,
  AIConditionNode,
  AIWaitNode,
  AIPlanEdge,
  AIPlanCompletionPolicy,
  AIPlanOutput,
  AIPlanValidationResult,
  TaskPlanStatus,
  TaskPlanNodeType,
  TaskPlanNodeStatus,
  TaskPlanEdgeType,
  TaskPlanNodeExecutionMode,
  TaskPlanNodeBlockingReason,
  TaskPlanNode,
  TaskPlanEdge,
  TaskPlanGraph,
  SavedTaskPlanGraph,
  TaskPlanGraphResponse,
} from "./ai";

// AI feature request/response contracts
export type {
  GenerateTaskPlanRequest,
  TaskWorkspaceChatRequest,
  TaskWorkspaceChatResponse,
  TaskWorkspaceUpdateProposal,
  ConflictAnalysisResult,
  TimeslotSuggestionResult,
} from "./ai";