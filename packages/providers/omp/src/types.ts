export interface OmpProviderConfig {
  /** Active OMP model override. Omitted means OMP profile default. */
  model?: string;
  /** Optional provider id for direct SDK credential/base URL overrides. Defaults to the provider prefix in model, then chrona. */
  provider?: string;
  /** Optional direct API key for OMP SDK runs. */
  apiKey?: string;
  /** Optional direct provider base URL for OMP SDK runs. */
  baseUrl?: string;
  /** Optional OMP wire API for direct base URL runs. Defaults to openai-responses for custom unprefixed models. */
  api?: "openai-responses" | "openai-completions" | "anthropic-messages" | "openrouter";
  /** Total run timeout in milliseconds. */
  timeoutMs?: number;
  /** Working directory for OMP SDK sessions. Defaults to current process cwd. */
  cwd?: string;
  /** Optional HOME override used when resolving ~/.omp. */
  homeDirectory?: string;
  /** Optional OMP config root override (PI_CONFIG_DIR). */
  configDirectory?: string;
  /** Optional OMP agent data directory override (PI_CODING_AGENT_DIR). */
  codingAgentDirectory?: string;
  /** Optional pass-through env vars applied before OMP SDK startup. */
  env?: Record<string, string>;
}
