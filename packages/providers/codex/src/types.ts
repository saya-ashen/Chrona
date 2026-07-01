import type { ProviderUsage } from "@chrona/providers-foundation";

export interface CodexProviderConfig {
  /** Override codex-acp executable. Defaults to package binary on PATH. */
  binaryPath?: string;
  /** Model ID passed to codex-acp through CODEX_CONFIG. */
  model?: string;
  /** Total prompt turn timeout in milliseconds. */
  timeoutMs?: number;
  /** OpenAI/Codex API key. Passed as CODEX_API_KEY. */
  apiKey?: string;
  /** OpenAI-compatible base URL passed through CODEX_CONFIG. */
  baseUrl?: string;
  /** Working directory for Codex. Defaults to current process cwd. */
  cwd?: string;
  /** Pass-through environment for codex-acp. */
  env?: Record<string, string>;
  /** Override Codex CLI executable used by codex-acp. */
  codexPath?: string;
  /** Initial codex-acp mode. */
  initialAgentMode?: "read-only" | "agent" | "agent-full-access";
  /** Hide browser-based ChatGPT auth in headless environments. */
  noBrowser?: boolean;
  /** Advanced Codex config merged into CODEX_CONFIG. */
  codexConfig?: Record<string, unknown>;
  /** Extra workspace roots passed to ACP session setup. */
  additionalDirectories?: string[];
  /** Chrona /api/mcp base URL. */
  mcpBaseUrl?: string;
  /** Chrona /api/mcp bearer token. */
  mcpRunToken?: string;
}

export type CodexRunnerMode = "acp";

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

export function codexAcpCommand(config: CodexProviderConfig): string {
  return config.binaryPath?.trim() || "codex-acp";
}

export function codexAcpEnv(config: CodexProviderConfig): Record<string, string> {
  const env = { ...process.env, ...(config.env ?? {}) } as Record<string, string>;
  const apiKey = config.apiKey?.trim();
  if (apiKey) {
    env.CODEX_API_KEY = apiKey;
    env.OPENAI_API_KEY = apiKey;
  }
  if (config.codexPath) env.CODEX_PATH = config.codexPath;
  if (config.initialAgentMode) env.INITIAL_AGENT_MODE = config.initialAgentMode;
  if (config.noBrowser) env.NO_BROWSER = "1";
  const codexConfig = buildCodexConfig(config);
  if (Object.keys(codexConfig).length > 0) {
    env.CODEX_CONFIG = JSON.stringify(codexConfig);
  }
  const authRequest = buildDefaultAuthRequest(config, apiKey);
  if (authRequest) {
    env.DEFAULT_AUTH_REQUEST = JSON.stringify(authRequest);
  }
  return env;
}

function buildDefaultAuthRequest(config: CodexProviderConfig, apiKey?: string): Record<string, unknown> | null {
  const baseUrl = config.baseUrl?.trim();
  if (baseUrl) {
    return {
      methodId: "gateway",
      _meta: {
        gateway: {
          baseUrl,
          providerName: "Chrona Codex Gateway",
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        },
      },
    };
  }
  if (apiKey) {
    return {
      methodId: "api-key",
      _meta: { "api-key": { apiKey } },
    };
  }
  return null;
}

function buildCodexConfig(config: CodexProviderConfig): Record<string, unknown> {
  return {
    ...(config.codexConfig ?? {}),
    ...(config.model ? { model: config.model } : {}),
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
  };
}

export function usageFromAcp(used?: number, size?: number): ProviderUsage | null {
  if (typeof used !== "number" && typeof size !== "number") return null;
  const inputTokens = typeof used === "number" ? used : 0;
  return {
    inputTokens,
    outputTokens: 0,
    totalTokens: inputTokens,
  };
}
