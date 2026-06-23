/**
 * @chrona/claude-code — Claude Code execution provider.
 *
 * Implements `AgentProviderClient` (from @chrona/providers-foundation) by
 * driving a local Claude Code headless run via the Claude Agent SDK per
 * `startRun`. Chrona's `/api/mcp` server is attached run-scoped via the
 * SDK `mcpServers` option.
 *
 * Spec: specs/017-provider-claude-code/spec.md
 * Plan / research gate: specs/017-provider-claude-code/plan.md §0
 */

export const CHRONA_CLAUDE_CODE_PROVIDER_TYPE = "claude_code";

export {
  ClaudeCodeProviderClient,
  type ClaudeCodeProviderOptions,
} from "./ClaudeCodeProviderClient";

export {
  ClaudeCodeProviderError,
  type ClaudeCodeProviderConfig,
  type ClaudeCodeRunnerMode,
} from "./types";

export {
  createClaudeCodeRunner,
  createReplayRunner,
  type ClaudeCodeRunHandle,
  type ClaudeCodeRunner,
  type ClaudeCodeRunnerConfig,
} from "./runner";
