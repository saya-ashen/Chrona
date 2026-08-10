/**
 * Internal types for the Claude Code provider. Public surface lives in
 * `index.ts`; the engine imports only from `index.ts` / contracts.
 *
 * No domain task, plan, or schedule semantics live here — this is the
 * protocol adaptation layer.
 */


/** Constructed from `ClaudeCodeClientConfig` plus runner env state. */
export interface ClaudeCodeProviderConfig {
  /** Default "claude-opus-4-8". */
  model?: string;
  /** Total run timeout (ms). Overall wall-clock bound on the SDK run. */
  timeoutMs?: number;
  /** Endpoint configuration retained for backward-compatible construction. */
  mcpBaseUrl: string;
  /** Endpoint credential retained for backward-compatible construction. */
  mcpRunToken: string;
  apiKey?: string;
  /** Pass-through env for the Claude Code subprocess / SDK call. */
  env?: Record<string, string>;
  /** Optional config/state directory. Omitted means Claude Code default user-level config. */
  configDirectory?: string;
  /** Reserved named profile selector. */
  profileName?: string;
  /** Working directory. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Resolved at construction: which runner back-end to use. */
  mode?: ClaudeCodeRunnerMode;

  /** Advanced SDK option overrides for isolated tests / embedders. Core transport options still win. */
  sdkOptions?: Partial<import("@anthropic-ai/claude-agent-sdk").Options>;
}

export type ClaudeCodeRunnerMode = "sdk" | "replay";

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
