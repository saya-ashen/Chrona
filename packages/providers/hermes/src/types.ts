export type HermesProviderConfig = {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
};

export class HermesProviderError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly raw?: unknown;

  constructor(input: {
    message: string;
    code: string;
    status?: number;
    retryable?: boolean;
    raw?: unknown;
  }) {
    super(input.message);
    this.name = "HermesProviderError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.raw = input.raw;
  }
}
