/**
 * Re-exports from split AI hook modules.
 * Prefer importing from specific sub-modules for better tree-shaking:
 *   @/hooks/ai/use-auto-complete
 *   @/hooks/ai/use-smart-decomposition
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
export {
  useSmartDecomposition,
  useBatchApplyPlan,
  useBatchApplyPlan as useBatchDecompose,
  type SmartDecompositionTaskInput,
} from "./ai/use-smart-decomposition";