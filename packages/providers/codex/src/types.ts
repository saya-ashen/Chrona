import type {
  ApprovalMode,
  CodexOptions,
  ModelReasoningEffort,
  SandboxMode,
  ThreadOptions,
  WebSearchMode,
} from "@openai/codex-sdk";

export interface CodexProviderConfig {
  /** Override Codex CLI executable. Defaults to SDK bundled executable. */
  binaryPath?: string;
  /** Model ID passed to Codex. */
  model?: string;
  /** Total turn timeout in milliseconds. */
  timeoutMs?: number;
  /** OpenAI/Codex API key. Passed as CODEX_API_KEY by the SDK. */
  apiKey?: string;
  /** OpenAI-compatible base URL passed through Codex SDK. */
  baseUrl?: string;
  /** Working directory for Codex. Defaults to current process cwd. */
  cwd?: string;
  /** Pass-through environment for Codex CLI. SDK does not inherit process.env when set. */
  env?: Record<string, string>;
  /** Codex sandbox mode. Defaults to SDK/CLI configuration. */
  sandboxMode?: SandboxMode;
  /** Codex approval policy. Defaults to SDK/CLI configuration. */
  approvalPolicy?: ApprovalMode;
  /** Optional model reasoning effort. */
  modelReasoningEffort?: ModelReasoningEffort;
  /** Optional web search mode. */
  webSearchMode?: WebSearchMode;
  /** Enable or disable Codex network access in workspace-write sandbox. */
  networkAccessEnabled?: boolean;
  /** Skip Codex git repository check. */
  skipGitRepoCheck?: boolean;
  /** Extra writable/readable roots passed to Codex. */
  additionalDirectories?: string[];
  /** Advanced Codex CLI config overrides. */
  sdkOptions?: CodexOptions["config"];
  /** Chrona /api/mcp base URL reserved for future Codex MCP wiring. */
  mcpBaseUrl?: string;
  /** Chrona /api/mcp bearer token reserved for future Codex MCP wiring. */
  mcpRunToken?: string;
}

export type CodexRunnerMode = "sdk";

export class CodexProviderError extends Error {
  readonly retryable: boolean;
  readonly provider: string;

  constructor(
    message: string,
    options: { retryable?: boolean; cause?: unknown; provider?: string } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "CodexProviderError";
    this.retryable = options.retryable ?? false;
    this.provider = options.provider ?? "codex";
  }
}

export function toCodexOptions(config: CodexProviderConfig): CodexOptions {
  return {
    codexPathOverride: config.binaryPath,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    config: config.sdkOptions,
    env: config.env,
  };
}

export function toThreadOptions(config: CodexProviderConfig): ThreadOptions {
  return {
    model: config.model,
    sandboxMode: config.sandboxMode,
    workingDirectory: config.cwd,
    skipGitRepoCheck: config.skipGitRepoCheck,
    modelReasoningEffort: config.modelReasoningEffort,
    networkAccessEnabled: config.networkAccessEnabled,
    webSearchMode: config.webSearchMode,
    approvalPolicy: config.approvalPolicy,
    additionalDirectories: config.additionalDirectories,
  };
}
