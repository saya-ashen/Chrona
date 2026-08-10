import type {
  AgentProviderClient,
  CancelRunInput,
  CreateSessionInput,
  GetRunInput,
  HealthCheckInput,
  StartRunInput,
  ProviderCapabilities,
  StreamRunInput,
} from "@chrona/providers-foundation";
import type {
  ProviderConversationHandoffInput,
  ProviderConversationTurnInput,
} from "@chrona/providers-foundation";
import { OmpSdkProviderClient } from "./OmpSdkProviderClient";
import type { OmpProviderConfig } from "./types";

export type OmpProviderOptions = {
  config?: OmpProviderConfig;
  sdkClient?: AgentProviderClient;
};

export class OmpProviderClient implements AgentProviderClient {
  readonly provider = "omp";
  private readonly sdk: AgentProviderClient;

  constructor(opts: OmpProviderOptions = {}) {
    this.sdk = opts.sdkClient ?? new OmpSdkProviderClient({ config: opts.config ?? {} });
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    const inherited = await this.sdk.getCapabilities();
    return {
      ...inherited,
      actionInvocation: "external_control_plane",
      startIdempotency: "unsupported",
      lookupByClientOperationId: false,
    };
  }

  getRuntimeDiagnostics() {
    if (!this.sdk.getRuntimeDiagnostics) {
      return Promise.reject(new Error("OMP runtime diagnostics are unavailable"));
    }
    return this.sdk.getRuntimeDiagnostics();
  }

  getConfigurationCapabilities() {
    return this.sdk.getConfigurationCapabilities?.() ?? {
      model: { supported: false, taskOverride: false },
      context: { supported: false, taskOverride: false, strategies: [] },
      tooling: {
        mcp: { supported: false, enabled: false },
        lsp: { supported: false, enabled: false },
        subagents: { supported: false, enabled: false },
        enabledTools: [],
      },
    };
  }

  getConversationCapabilities() {
    return this.sdk.getConversationCapabilities?.() ?? {
      resume: false,
      fork: false,
      compact: false,
      handoff: "unsupported" as const,
      contextUsage: "none" as const,
    };
  }

  inspectConversation(sessionRef: string) {
    if (!this.sdk.inspectConversation) {
      return Promise.resolve({ available: false, sessionRef, compacted: false });
    }
    return this.sdk.inspectConversation(sessionRef);
  }

  handoffConversation(input: ProviderConversationHandoffInput) {
    if (!this.sdk.handoffConversation) {
      return Promise.reject(new Error("OMP conversation handoff is unavailable"));
    }
    return this.sdk.handoffConversation(input);
  }

  runConversationTurn(input: ProviderConversationTurnInput) {
    if (!this.sdk.runConversationTurn) {
      return Promise.reject(new Error("OMP conversation continuation is unavailable"));
    }
    return this.sdk.runConversationTurn(input);
  }

  checkHealth(input?: HealthCheckInput) {
    return this.sdk.checkHealth(input);
  }

  createSession(input?: CreateSessionInput) {
    return this.sdk.createSession(input);
  }

  startRun(input: StartRunInput) {
    return this.sdk.startRun(input);
  }

  streamRun(input: StreamRunInput) {
    return this.sdk.streamRun(input);
  }

  getRun(input: GetRunInput) {
    return this.sdk.getRun(input);
  }

  cancelRun(input: CancelRunInput) {
    return this.sdk.cancelRun(input);
  }
}
