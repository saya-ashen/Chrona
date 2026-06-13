/**
 * Internal types for the Claude Code provider. Public surface lives in
 * `index.ts`; the engine imports only from `index.ts` / contracts.
 *
 * No Chrona task / plan / schedule semantics here — this is the protocol
 * adaptation layer (milestone §5 rule 3).
 */

/** Constructed from `ClaudeCodeClientConfig` plus runner env state. */
export interface ClaudeCodeProviderConfig {
  /** Override the `claude` CLI path (CLI fallback only). Default: "claude". */
  binaryPath?: string;
  /** Default "claude-opus-4-8". */
  model?: string;
  /** Total run timeout. SDK uses as overall bound; CLI uses as SIGKILL fallback. */
  timeoutMs?: number;
  /** Chrona /api/mcp base URL. Defaults to the hosting server. */
  mcpBaseUrl: string;
  /** Anthropic API key (recommended for production; subscription quota may otherwise apply). */
  apiKey?: string;
  /** Pass-through env for the Claude Code subprocess / SDK call. */
  env?: Record<string, string>;
  /** Working directory. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Resolved at construction: which runner back-end to use. */
  mode?: ClaudeCodeRunnerMode;
}

export type ClaudeCodeRunnerMode = "sdk" | "cli" | "replay";

/** Error category for `ClaudeCodeProviderClient`. Thrown only when retryable. */
export class ClaudeCodeProviderError extends Error {
  readonly retryable: boolean;
  readonly provider: string;
  constructor(
    message: string,
    options: { retryable?: boolean; cause?: unknown; provider?: string } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ClaudeCodeProviderError";
    this.retryable = options.retryable ?? false;
    this.provider = options.provider ?? "claude_code";
  }
}
