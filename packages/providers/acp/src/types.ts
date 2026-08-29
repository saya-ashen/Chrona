import type { ProviderUsage } from "@chrona/providers-foundation";

export type AcpProviderConfig = {
  /** Chrona provider id exposed to runtime events. */
  provider: string;
  /** Human-readable provider name for health/capability messages. */
  displayName?: string;
  /** ACP stdio command. */
  command: string;
  /** ACP stdio command arguments. */
  args?: string[];
  /** Total prompt turn timeout in milliseconds. */
  timeoutMs?: number;
  /** Health depth. "session" opens a session; "prompt" also verifies the configured model endpoint. */
  healthCheck?: "initialize" | "session" | "prompt";
  /** Authentication strategy. useExisting keeps the agent's current local profile without starting a new login. */
  auth?: { methodId?: string; prefer?: "agent" | "env_var" | "terminal"; terminal?: boolean; useExisting?: boolean };
  /** Working directory for the ACP agent. Defaults to current process cwd. */
  cwd?: string;
  /** Pass-through environment for the ACP subprocess. */
  env?: Record<string, string>;
  /** Extra workspace roots passed to ACP session setup. */
  additionalDirectories?: string[];
  /** Chrona /api/mcp base URL. */
  mcpBaseUrl?: string;
  /** Chrona /api/mcp bearer token. */
  mcpRunToken?: string;
};

export class AcpProviderError extends Error {
  readonly retryable: boolean;
  readonly provider: string;

  constructor(
    message: string,
    options: { retryable?: boolean; cause?: unknown; provider?: string } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AcpProviderError";
    this.retryable = options.retryable ?? false;
    this.provider = options.provider ?? "acp";
  }
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
