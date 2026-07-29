export type {
  DebugProfiledProviderClient,
  EngineAiClient,
  EngineProviderClient,
  EngineLlmClient,
  EngineHermesClient,
  EngineDebugClient,
  EngineClaudeCodeClient,
  EngineCodexClient,
  EngineOmpClient,
} from "./runtime/client-registry";
export { getProviderBaseUrl, AiClientRegistry, aiClientRegistry } from "./runtime/client-registry";
export { getAiClient, getAiClientForFeature, getAiClientForTask, requireAiClient } from "./runtime/client-resolution";
export { aiChat, aiGeneratePlanStream } from "./runtime/ai-service";
export { chat } from "./feature-normalizers";
export { dispatchStream, suggestStream } from "./streaming";
export { AiClientManagement, aiClientManagement } from "./management/ai-client-management";
export type { ProviderFeatureRequest } from "./providers";
export {
  testAiClientAvailability,
  runProviderRequest,
  extractJSON,
  providerCall,
  llmCall,
  buildPreparedFeatureRequest,
  buildProviderFeatureRequest,
  dispatch,
  dispatchFeaturePayload,
} from "./providers";
export { createProviderStreamEventBoundary, ProviderStreamContractError } from "./provider-stream-contract";
export type { ProviderStreamEventBoundary } from "./provider-stream-contract";
export { analyzeConflicts, analyzeConflictsSmart } from "./conflict-analyzer";
export {
  detectDependencyConflicts,
  detectFragmentation,
  detectOverload,
  detectTimeOverlaps,
} from "./conflict-detector";
export { generatePlanStream } from "./features/generate-plan";
