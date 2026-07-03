import { AcpProviderClient, type AcpProviderOptions } from "@chrona/acp-provider";
import type { AgentProviderClient, CancelRunInput, CreateSessionInput, GetRunInput, HealthCheckInput, StartRunInput, StreamRunInput } from "@chrona/providers-foundation";
import { codexAcpConfig, type CodexProviderConfig } from "./types";

export type CodexProviderOptions = {
  config?: CodexProviderConfig;
  acp?: Omit<AcpProviderOptions, "config">;
};

export class CodexProviderClient implements AgentProviderClient {
  readonly provider = "codex";
  private readonly acp: AcpProviderClient;

  constructor(opts: CodexProviderOptions = {}) {
    this.acp = new AcpProviderClient({
      ...(opts.acp ?? {}),
      config: codexAcpConfig(opts.config ?? {}),
    });
  }

  getCapabilities() {
    return this.acp.getCapabilities();
  }

  checkHealth(input?: HealthCheckInput) {
    return this.acp.checkHealth(input);
  }

  createSession(input?: CreateSessionInput) {
    return this.acp.createSession(input);
  }

  startRun(input: StartRunInput) {
    return this.acp.startRun(input);
  }

  streamRun(input: StreamRunInput) {
    return this.acp.streamRun(input);
  }

  getRun(input: GetRunInput) {
    return this.acp.getRun(input);
  }

  cancelRun(input: CancelRunInput) {
    return this.acp.cancelRun(input);
  }
}
