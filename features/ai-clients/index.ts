export type {
  AiClientRecord,
  AiClientType,
  AiFeature,
  AgentProviderClientConfig,
  ClaudeCodeClientConfig,
  DebugClientConfig,
  DebugProviderProfile,
  HermesClientConfig,
  LLMClientConfig,
} from "@chrona/contracts";
export { AI_FEATURES, AiClientError } from "@chrona/contracts";

export type {
  DebugProfiledProviderClient,
  EngineAiClient,
  EngineProviderClient,
  EngineLlmClient,
  EngineHermesClient,
  EngineDebugClient,
  EngineClaudeCodeClient,
} from "./runtime/client-registry";
export {
  getProviderBaseUrl,
  AiClientRegistry,
  aiClientRegistry,
} from "./runtime/client-registry";
export { AiClientManagement, aiClientManagement } from "./model/ai-client-management";
export { testAiClientAvailability } from "../../packages/engine/src/modules/ai/providers";
export { AiClientsDialog } from "./ui/ai-clients-dialog";
export { AiClientsManager } from "./ui/ai-clients-manager";
