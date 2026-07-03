/**
 * @chrona/codex — OpenAI Codex execution provider.
 *
 * Implements `AgentProviderClient` by driving Codex through the
 * Agent Client Protocol `codex-acp` adapter.
 */

export const CHRONA_CODEX_PROVIDER_TYPE = "codex";

export {
  CodexProviderClient,
  type CodexProviderOptions,
} from "./CodexProviderClient";

export { type CodexProviderConfig } from "./types";
