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

export { AiClientsDialog } from "./ui/ai-clients-dialog";
export { AiClientsManager } from "./ui/ai-clients-manager";
export {
  AI_CLIENTS_CHANGED_EVENT,
  listenAiClientsChanged,
  notifyAiClientsChanged,
} from "./events";
