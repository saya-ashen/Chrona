/**
 * @chrona/claude-code — Claude Code execution provider.
 *
 * Implements `AgentProviderClient` (from @chrona/providers-foundation) by
 * driving a local Claude Code headless run via the Claude Agent SDK per
 * `startRun`. Request-declared tools are attached through the SDK MCP
 * transport for that run.
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
