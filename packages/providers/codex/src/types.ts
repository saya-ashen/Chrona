import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { AcpProviderConfig } from "@chrona/acp-provider";

export interface CodexProviderConfig {
  /** Internal codex-acp executable override. Defaults to package binary on PATH. */
  binaryPath?: string;
  /** Model ID passed to codex-acp through CODEX_CONFIG. */
  model?: string;
  /** Total prompt turn timeout in milliseconds. */
  timeoutMs?: number;
  /** OpenAI/Codex API key. Passed as CODEX_API_KEY. */
  apiKey?: string;
  /** OpenAI-compatible base URL passed through CODEX_CONFIG/default gateway auth. */
  baseUrl?: string;
  /** Working directory for Codex. Defaults to current process cwd. */
  cwd?: string;
  /** Pass-through environment for codex-acp. */
  env?: Record<string, string>;
  /** Optional Codex home directory. Omitted means default user-level CODEX_HOME (~/.codex). */
  configDirectory?: string;
  /** Reserved Codex named profile selector. codex-acp cannot apply it yet. */
  profileName?: string;
  /** Internal Codex CLI executable override used by codex-acp. */
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
const require = createRequire(import.meta.url);
const CODEX_ACP_PACKAGE_NAME = "@agentclientprotocol/codex-acp";

const CHRONA_MCP_DIRECT_TOOL_NAMESPACES = ["chrona", "mcp__chrona"] as const;

export function codexAcpConfig(config: CodexProviderConfig): AcpProviderConfig {
  return {
    provider: "codex",
    displayName: "OpenAI Codex",
    command: config.binaryPath?.trim() || codexAcpBinaryPath(),
    timeoutMs: config.timeoutMs,
    healthCheck: "session",
    cwd: config.cwd,
    env: codexAcpEnv(config),
    additionalDirectories: config.additionalDirectories,
    mcpBaseUrl: config.mcpBaseUrl,
    mcpRunToken: config.mcpRunToken,
  };
}

export function codexAcpEnv(config: CodexProviderConfig): Record<string, string> {
  const env = { ...(config.env ?? {}) } as Record<string, string>;
  const configDirectory = config.configDirectory?.trim();
  if (configDirectory) env.CODEX_HOME = configDirectory;
  const apiKey = config.apiKey?.trim();
  if (apiKey) {
    env.CODEX_API_KEY = apiKey;
    env.OPENAI_API_KEY = apiKey;
  }
  if (config.baseUrl?.trim()) env.MODEL_PROVIDER = "chrona-gateway";
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


function codexAcpBinaryPath(): string {
  try {
    return join(dirname(require.resolve(`${CODEX_ACP_PACKAGE_NAME}/package.json`)), "dist/index.js");
  } catch {
    return "codex-acp";
  }
}

function buildDefaultAuthRequest(config: CodexProviderConfig, apiKey?: string): Record<string, unknown> | null {
  const baseUrl = config.baseUrl?.trim();
  if (baseUrl) {
    return {
      methodId: "gateway",
      _meta: {
        gateway: {
          baseUrl,
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          providerName: "Chrona Codex Gateway",
        },
      },
    };
  }
  if (!apiKey) return null;
  return {
    methodId: "api-key",
    _meta: { "api-key": { apiKey } },
  };
}

function buildCodexConfig(config: CodexProviderConfig): Record<string, unknown> {
  const codexConfig = {
    ...(config.codexConfig ?? {}),
    ...(config.model ? { model: config.model } : {}),
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
  };
  const gatewayConfig = config.baseUrl ? chronaGatewayProviderConfig(config) : null;
  return withChronaGatewayProvider(withChronaDirectToolNamespaces(codexConfig), gatewayConfig);
}

function chronaGatewayProviderConfig(config: CodexProviderConfig): Record<string, unknown> {
  const baseUrl = config.baseUrl?.trim();
  return {
    name: "Chrona Codex Gateway",
    base_url: baseUrl,
    http_headers: config.apiKey?.trim()
      ? { Authorization: `Bearer ${config.apiKey.trim()}` }
      : {},
    wire_api: "responses",
  };
}

function withChronaDirectToolNamespaces(codexConfig: Record<string, unknown>): Record<string, unknown> {
  const features = isRecord(codexConfig.features) ? codexConfig.features : {};
  const codeMode = isRecord(features.code_mode) ? features.code_mode : {};
  const existing = Array.isArray(codeMode.direct_only_tool_namespaces)
    ? codeMode.direct_only_tool_namespaces.filter((value): value is string => typeof value === "string")
    : [];
  return {
    ...codexConfig,
    features: {
      ...features,
      code_mode: {
        ...codeMode,
        enabled: true,
        direct_only_tool_namespaces: [...new Set([...existing, ...CHRONA_MCP_DIRECT_TOOL_NAMESPACES])],
      },
    },
  };
}


function withChronaGatewayProvider(
  codexConfig: Record<string, unknown>,
  gatewayConfig: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!gatewayConfig) return codexConfig;
  const modelProviders = isRecord(codexConfig.model_providers)
    ? codexConfig.model_providers
    : {};
  return {
    ...codexConfig,
    model_provider: "chrona-gateway",
    model_providers: {
      ...modelProviders,
      "chrona-gateway": gatewayConfig,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
