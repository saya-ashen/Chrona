/**
 * Re-exports from split AI hook modules.
 * Prefer importing from specific sub-modules for better tree-shaking:
 *   @/hooks/ai/use-auto-complete
 *   @/hooks/ai/use-apply-suggestion
 *   @/hooks/ai/use-smart-automation
 *   @/hooks/ai/use-smart-decomposition
 *   @/hooks/ai/use-smart-timeslot
 *   @/hooks/ai/types
 */

export type {
  StructuredSuggestion,
  AutoCompleteSuggestion,
  StreamToolCall,
  StreamToolResult,
  StreamPhase,
} from "./ai/types";

export { useAutoComplete } from "./ai/use-auto-complete";
export { useApplySuggestion } from "./ai/use-apply-suggestion";
export {
  useSmartAutomation,
  type SmartAutomationTaskInput,
} from "./ai/use-smart-automation";
export {
  useSmartDecomposition,
  useBatchApplyPlan,
  useBatchApplyPlan as useBatchDecompose,
  type SmartDecompositionTaskInput,
} from "./ai/use-smart-decomposition";
export {
  useSmartTimeslot,
  type SmartTimeslotTaskInput,
} from "./ai/use-smart-timeslot";
