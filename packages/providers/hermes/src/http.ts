import { HermesProviderError, type HermesProviderConfig } from "./types";

export type HermesHttpClient = {
  request(
    path: string,
    init?: RequestInit & { idempotencyKey?: string; timeoutMs?: number },
  ): Promise<Response>;
};

export function createHermesHttpClient(config: HermesProviderConfig): HermesHttpClient {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const timeoutMs = config.timeoutMs ?? 30_000;

  return {
    async request(path, init = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? timeoutMs);
      const signal = mergeSignals(controller.signal, init.signal ?? undefined);

      try {
        const headers = new Headers(init.headers);
        headers.set("Content-Type", "application/json");
        if (config.apiKey) {
          headers.set("Authorization", `Bearer ${config.apiKey}`);
        }
        if (init.idempotencyKey) {
          headers.set("Idempotency-Key", init.idempotencyKey);
        }

        return await fetch(`${baseUrl}${path}`, {
          ...init,
          headers,
          signal,
        });
      } catch (error) {
        if (signal.aborted) {
          const externalAbort = init.signal?.aborted === true;
          throw new HermesProviderError({
            message: "Hermes request aborted",
            code: "aborted",
            retryable: !externalAbort,
            raw: error,
          });
        }
        throw new HermesProviderError({
          message: error instanceof Error ? error.message : "Hermes network error",
          code: "network_error",
          retryable: true,
          raw: error,
        });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function ensureHermesOk(response: Response, operation: string): Promise<unknown> {
  const body = await readJson(response);
  if (response.ok) {
    return body;
  }

  if (response.status === 429) {
    throw new HermesProviderError({
      message: "Hermes rate limit exceeded",
      code: "rate_limited",
      status: response.status,
      retryable: true,
      raw: body,
    });
  }

  if (response.status === 401 || response.status === 403) {
    throw new HermesProviderError({
      message: `Hermes ${operation} failed with HTTP ${response.status}. Check Hermes API token.`,
      code: "misconfigured",
      status: response.status,
      retryable: false,
      raw: body,
    });
  }

  throw new HermesProviderError({
    message: `Hermes ${operation} failed with HTTP ${response.status}`,
    code: "provider_error",
    status: response.status,
    retryable: response.status >= 500,
    raw: body,
  });
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const normalized = baseUrl?.trim().replace(/\/+$/, "") ?? "";
  return normalized || "http://127.0.0.1:8642";
}

function mergeSignals(primary: AbortSignal, secondary?: AbortSignal): AbortSignal {
  if (!secondary) {
    return primary;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  primary.addEventListener("abort", abort, { once: true });
  secondary.addEventListener("abort", abort, { once: true });
  if (primary.aborted || secondary.aborted) {
    controller.abort();
  }
  return controller.signal;
}
