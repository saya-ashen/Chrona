export type {
  StructuredSuggestion,
  AutoCompleteSuggestion,
  StreamToolCall,
  StreamToolResult,
  StreamPhase,
  SmartAutomationTaskInput,
  SmartDecompositionTaskInput,
  SmartTimeslotTaskInput,
} from "@chrona/contracts/legacy-hooks/use-ai";

export {
  useAutoComplete,
  useApplySuggestion,
  useSmartAutomation,
  useSmartDecomposition,
  useBatchApplyPlan,
  useBatchDecompose,
  useSmartTimeslot,
} from "@chrona/contracts/legacy-hooks/use-ai";
