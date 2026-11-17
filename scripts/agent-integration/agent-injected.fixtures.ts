import { agent } from "../../packages/kernel/src/system/agent";

// Legacy test-provider imports these declarations. Acceptance fixtures use the
// real system Agent and an activated external Pi; no local Agent is installed.
export const injectedAgentTools = agent.tools;
export const injectedAgentPrimitive = agent.handle;
