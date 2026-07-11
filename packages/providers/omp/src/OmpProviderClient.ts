import type {
  AgentProviderClient,
  CancelRunInput,
  CreateSessionInput,
  GetRunInput,
  HealthCheckInput,
  StartRunInput,
  StreamRunInput,
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

  getCapabilities() {
    return this.sdk.getCapabilities();
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
