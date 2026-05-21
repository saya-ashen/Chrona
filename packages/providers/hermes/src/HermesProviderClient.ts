import type {
  AgentProviderClient,
  CancelRunInput,
  CreateSessionInput,
  ExistingRunStreamInput,
  GetRunInput,
  HealthCheckInput,
  ProviderCapabilities,
  ProviderHealth,
  ProviderRunEvent,
  ProviderRunRef,
  ProviderRunSnapshot,
  StartRunInput,
  StreamRunInput,
} from "@chrona/providers-foundation";
import {
  createHermesHttpClient,
  ensureHermesOk,
  readJson,
  type HermesHttpClient,
} from "./http";
import {
  asRecord,
  mapCapabilities,
  mapHermesEvent,
  mapSnapshot,
} from "./normalizers";
import { parseSseData } from "./sse";
import { HermesProviderError, type HermesProviderConfig } from "./types";

type HermesInputMessage = {
  role?: string;
  content?: unknown;
};

type HermesRunBody = {
  input: string;
  session_id?: string;
  instructions?: string;
  conversation_history?: HermesInputMessage[];
  previous_response_id?: string;
};

export class HermesProviderClient implements AgentProviderClient {
  readonly provider = "hermes";

  private readonly http: HermesHttpClient;

  constructor(config: HermesProviderConfig = {}) {
    this.http = createHermesHttpClient(config);
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    try {
      const response = await this.http.request("/v1/capabilities", {
        method: "GET",
      });
      const body = await ensureHermesOk(response, "capabilities");

      return mapCapabilities(body);
    } catch (error) {
      return mapCapabilities(
        undefined,
        error instanceof Error ? error.message : "capabilities endpoint failed",
      );
    }
  }

  async checkHealth(
    input: HealthCheckInput & { deep?: boolean } = {},
  ): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const started = Date.now();
    const paths = input.deep
      ? ["/health/detailed", "/health"]
      : ["/health", "/v1/health"];
    let lastReason = "Hermes health check failed";
    let healthRaw: unknown;

    for (const path of paths) {
      try {
        const response = await this.http.request(path, {
          method: "GET",
          signal: input.signal,
          timeoutMs: input.timeoutMs,
        });
        const raw = await readJson(response);
        const latencyMs = Date.now() - started;
        if (response.ok) {
          if (input.deep) {
            healthRaw = raw;
            break;
          }
          return {
            provider: this.provider,
            ok: true,
            checkedAt,
            latencyMs,
            status: "ok",
            raw,
          };
        }
        if (response.status === 401 || response.status === 403) {
          return misconfiguredHealth(
            checkedAt,
            latencyMs,
            response.status,
            "health check",
            raw,
          );
        }
        lastReason = `Hermes health check returned HTTP ${response.status}`;
      } catch (error) {
        lastReason =
          error instanceof Error ? error.message : "Hermes network error";
      }
    }

    if (input.deep && healthRaw !== undefined) {
      try {
        const response = await this.http.request("/v1/capabilities", {
          method: "GET",
          signal: input.signal,
          timeoutMs: input.timeoutMs,
        });
        const raw = await readJson(response);
        const latencyMs = Date.now() - started;
        if (response.ok) {
          return {
            provider: this.provider,
            ok: true,
            checkedAt,
            latencyMs,
            status: "ok",
            raw: { health: healthRaw, capabilities: raw },
          };
        }
        if (response.status === 401 || response.status === 403) {
          return misconfiguredHealth(
            checkedAt,
            latencyMs,
            response.status,
            "capabilities check",
            raw,
          );
        }
        lastReason = `Hermes capabilities check returned HTTP ${response.status}`;
      } catch (error) {
        lastReason =
          error instanceof Error
            ? error.message
            : "Hermes capabilities check failed";
      }
    }

    return {
      provider: this.provider,
      ok: false,
      checkedAt,
      latencyMs: Date.now() - started,
      status: "unavailable",
      reason: lastReason,
    };
  }

  async createSession(input: CreateSessionInput = {}) {
    const sessionId =
      input.sessionKey ?? `hermes_session_${crypto.randomUUID()}`;
    return {
      provider: this.provider,
      sessionId,
      nativeSessionId: sessionId,
      providerSessionId: sessionId,
      state: "virtual",
      sessionKey: input.sessionKey,
      createdAt: new Date().toISOString(),
    };
  }

  async startRun(
    input: StartRunInput & { idempotencyKey?: string },
  ): Promise<ProviderRunRef> {
    const body = buildRunBody(input);
    const response = await this.http.request("/v1/runs", {
      method: "POST",
      body: JSON.stringify(body),
      signal: input.signal,
      idempotencyKey: input.idempotencyKey,
      timeoutMs: input.timeoutMs,
    });
    const raw = asRecord(await ensureHermesOk(response, "start run"));
    const runId = typeof raw.run_id === "string" ? raw.run_id : undefined;
    if (!runId) {
      throw new HermesProviderError({
        message: "Hermes start run response missing run_id",
        code: "invalid_response",
        retryable: false,
        raw,
      });
    }

    return {
      provider: this.provider,
      runId,
      providerRunId: runId,
      nativeRunId: runId,
      sessionId: input.sessionId,
      status: "running",
      startedAt: new Date().toISOString(),
      stream: {
        supported: true,
        reconnectable: true,
      },
      raw,
    };
  }

  streamRun(input: ExistingRunStreamInput): AsyncIterable<ProviderRunEvent>;
  streamRun(input: StreamRunInput): AsyncIterable<ProviderRunEvent>;
  async *streamRun(
    input: ExistingRunStreamInput | StreamRunInput,
  ): AsyncIterable<ProviderRunEvent> {
    const runId =
      "runId" in input && typeof input.runId === "string"
        ? input.runId
        : undefined;
    if (!runId) {
      throw new HermesProviderError({
        message: "Hermes streamRun requires runId",
        code: "invalid_input",
        retryable: false,
      });
    }

    const response = await this.http.request(
      `/v1/runs/${encodeURIComponent(runId)}/events`,
      {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        signal: input.signal,
      },
    );
    await ensureStreamOk(response);
    if (!response.body) {
      throw new HermesProviderError({
        message: "Hermes stream response missing body",
        code: "invalid_response",
        retryable: true,
      });
    }

    const includeRaw = "include" in input && input.include?.rawEvents === true;
    const strictUnknown = shouldThrowOnUnknownStreamEvent();
    let sequence = 0;
    for await (const rawEvent of parseSseData(response.body)) {
      const event = mapHermesEvent(rawEvent, runId, {
        includeRaw,
        strictUnknown,
        sequence: sequence++,
      });

      if (!event) {
        continue;
      }
      yield event;
      if (
        event.type === "run_completed" ||
        event.type === "run_failed" ||
        event.type === "run_cancelled"
      ) {
        return;
      }
    }
  }

  async getRun(
    input: GetRunInput & { include?: { raw?: boolean }; timeoutMs?: number },
  ): Promise<ProviderRunSnapshot> {
    const response = await this.http.request(
      `/v1/runs/${encodeURIComponent(input.runId)}`,
      {
        method: "GET",
        signal: input.signal,
        timeoutMs: input.timeoutMs,
      },
    );
    return mapSnapshot(
      await ensureHermesOk(response, "get run"),
      input.include?.raw === true,
    );
  }

  async cancelRun(input: CancelRunInput): Promise<ProviderRunSnapshot> {
    const response = await this.http.request(
      `/v1/runs/${encodeURIComponent(input.runId)}/stop`,
      {
        method: "POST",
        body: JSON.stringify(input.reason ? { reason: input.reason } : {}),
        signal: input.signal,
      },
    );
    return mapSnapshot(await ensureHermesOk(response, "cancel run"), true);
  }
}

function misconfiguredHealth(
  checkedAt: string,
  latencyMs: number,
  status: number,
  operation: string,
  raw: unknown,
): ProviderHealth {
  return {
    provider: "hermes",
    ok: false,
    checkedAt,
    latencyMs,
    status: "misconfigured",
    reason: `Hermes ${operation} returned HTTP ${status}. Check Hermes API token.`,
    raw,
  };
}

function shouldThrowOnUnknownStreamEvent(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.CHRONA_HERMES_STRICT_UNKNOWN_EVENTS !== "0"
  );
}

function buildRunBody(input: StartRunInput): HermesRunBody {
  const body: HermesRunBody = {
    input: normalizeRunInput(input.input),
    session_id: input.sessionId,
    instructions: input.instructions,
  };

  if (input.previousResponseId) {
    body.previous_response_id = input.previousResponseId;
  }

  const providerInput = asRecord(input.input);
  if (providerInput.type === "messages") {
    const messages = Array.isArray(providerInput.messages)
      ? (providerInput.messages as HermesInputMessage[])
      : [];
    const lastIndex = findLastUserOrMessageIndex(messages);
    const lastMessage = lastIndex >= 0 ? messages[lastIndex] : undefined;
    body.input = normalizeMessageContent(lastMessage?.content);
    body.conversation_history =
      lastIndex >= 0 ? messages.slice(0, lastIndex) : messages;
  }

  return body;
}

function normalizeRunInput(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  const providerInput = asRecord(input);
  if (providerInput.type === "text") {
    return normalizeMessageContent(providerInput.text);
  }

  return normalizeMessageContent(input);
}

function findLastUserOrMessageIndex(messages: HermesInputMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (
      messages[index]?.role === "user" ||
      messages[index]?.content !== undefined
    ) {
      return index;
    }
  }
  return -1;
}

function normalizeMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const record = asRecord(part);
        return typeof record.text === "string" ? record.text : undefined;
      })
      .filter((text): text is string => Boolean(text))
      .join("\n");
  }
  if (content == null) {
    return "";
  }
  return JSON.stringify(content);
}

async function ensureStreamOk(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }
  await ensureHermesOk(response, "stream run");
}
