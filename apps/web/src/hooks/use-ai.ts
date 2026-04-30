export type {
  StructuredSuggestion,
  AutoCompleteSuggestion,
  StreamToolCall,
  StreamToolResult,
  StreamPhase,
  SmartDecompositionTaskInput,
} from "@chrona/contracts/hooks/use-ai";

export {
  useAutoComplete,
  useSmartDecomposition,
  useBatchApplyPlan,
  useBatchDecompose,
} from "@chrona/contracts/hooks/use-ai";