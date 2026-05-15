import type {
  ProviderCapabilities,
  ProviderRunEvent,
  ProviderRunSnapshot,
  ProviderRunStatus,
  ProviderUsage,
} from "@chrona/providers-foundation";

const defaultCapabilities: ProviderCapabilities = {
  supportsSessions: true,
  supportsStreaming: true,
  supportsRunLookup: true,
  supportsCancellation: true,
  supportsToolCalls: true,
  supportsPreviousResponse: false,
};

export function mapCapabilities(raw: unknown, fallbackReason?: string): ProviderCapabilities {
  if (fallbackReason) {
    return {
      ...defaultCapabilities,
      reason: fallbackReason,
      details: { fallback: true },
    };
  }

  const features = asRecord(asRecord(raw).features);
  return {
    supportsSessions: true,
    supportsStreaming: Boolean(features.run_events_sse),
    supportsRunLookup: Boolean(features.run_status),
    supportsCancellation: Boolean(features.run_stop),
    supportsToolCalls: true,
    supportsPreviousResponse: false,
    details: {
      runs: {
        start: Boolean(features.run_submission),
        status: Boolean(features.run_status),
        stream: Boolean(features.run_events_sse),
        cancel: Boolean(features.run_stop),
      },
      raw,
    },
  };
}

export function mapUsage(raw: unknown): ProviderUsage | undefined {
  const usage = asRecord(raw);
  const inputTokens = numberValue(usage.input_tokens);
  const outputTokens = numberValue(usage.output_tokens);
  const totalTokens = numberValue(usage.total_tokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return { inputTokens, outputTokens, totalTokens };
}

export function mapStatus(rawStatus: unknown): ProviderRunStatus {
  switch (rawStatus) {
    case "queued":
      return "queued";
    case "started":
    case "running":
      return "running";
    case "waiting_for_approval":
      return "waiting_for_approval";
    case "stopping":
      return "stopping";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "running";
  }
}

export function mapSnapshot(raw: unknown, includeRaw = false): ProviderRunSnapshot {
  const body = asRecord(raw);
  const runId = stringValue(body.run_id) ?? stringValue(body.id) ?? "unknown";
  const sessionId = stringValue(body.session_id);
  const outputText = stringValue(body.output);
  const usage = mapUsage(body.usage);

  return {
    provider: "hermes",
    runId,
    providerRunId: runId,
    sessionId,
    status: mapStatus(body.status),
    rawStatus: stringValue(body.status),
    outputText,
    output: outputText === undefined ? undefined : { text: outputText },
    usage,
    error: stringValue(body.error) ?? undefined,
    raw: includeRaw ? raw : undefined,
  };
}

export function mapHermesEvent(
  event: unknown,
  runId: string,
  options: { includeRaw: boolean; strictUnknown?: boolean; sequence?: number },
): ProviderRunEvent | undefined {
  const body = asRecord(event);
  const type = stringValue(body.type) ?? stringValue(body.event);
  const metadata = buildEventMetadata({
    body,
    fallbackRunId: runId,
    sequence: options.sequence,
  });
  const raw = options.includeRaw ? event : undefined;

  switch (type) {
    case "message.delta":
      return {
        ...metadata,
        type: "text_delta",
        text: stringValue(body.delta) ?? "",
      };
    case "tool.started":
      return {
        ...metadata,
        type: "tool_started",
        toolName: stringValue(body.tool) ?? "unknown",
        preview: body.preview,
        input: body.input,
        raw,
      };
    case "tool.completed": {
      const error = body.error;
      return {
        ...metadata,
        type: "tool_completed",
        toolName: stringValue(body.tool),
        error: error === undefined || error === null || error === false
          ? undefined
          : normalizeError(error),
        raw,
      };
    }
    case "reasoning.available":
      return {
        ...metadata,
        type: "reasoning_delta",
        text: stringValue(body.text) ?? "",
        raw,
      };
    case "approval.request":
      return {
        ...metadata,
        type: "approval_required",
        approval: {
          runId: metadata.runId ?? runId,
          choices: body.choices,
          raw: event,
        },
        raw,
      };
    case "run.completed": {
      const outputText = stringValue(body.output);
      return {
        ...metadata,
        type: "run_completed",
        run: {
          provider: "hermes",
          runId: metadata.runId ?? runId,
          sessionId: stringValue(body.session_id) ?? "unknown",
          providerRunId: metadata.runId ?? runId,
          status: "completed",
        },
        outputText,
        output: outputText === undefined ? undefined : { text: outputText },
        usage: mapUsage(body.usage),
        raw,
      };
    }
    case "run.failed":
      return {
        ...metadata,
        type: "run_failed",
        error: stringValue(body.error) ?? "Hermes run failed",
        raw,
      };
    case "run.cancelled":
      return {
        ...metadata,
        type: "run_cancelled",
        raw,
      };
    default: {
      if (options.strictUnknown) {
        throw new Error(`Unknown Hermes stream event type: ${type ?? "<missing>"}`);
      }
      return options.includeRaw ? { ...metadata, type: "raw_event", raw: event } : undefined;
    }
  }
}

function buildEventMetadata(input: {
  body: Record<string, unknown>;
  fallbackRunId: string;
  sequence?: number;
}) {
  const rawEventType = stringValue(input.body.type) ?? stringValue(input.body.event);
  const timestampValue = stringValue(input.body.timestamp) ?? stringValue(input.body.time);
  const durationMs = numberValue(input.body.duration);
  return {
    provider: "hermes",
    runId: stringValue(input.body.run_id) ?? input.fallbackRunId,
    sessionId: stringValue(input.body.session_id),
    sequence: input.sequence,
    timestamp: timestampValue,
    rawEventType,
    durationMs,
  } satisfies Partial<ProviderRunEvent>;
}

function normalizeError(error: unknown): { message: string; code?: string; raw?: unknown } {
  if (typeof error === "string") {
    return { message: error };
  }
  const record = asRecord(error);
  const message = extractErrorMessage(record) ?? "Hermes tool failed";
  return {
    message,
    code: stringValue(record.code),
    raw: error,
  };
}

function extractErrorMessage(record: Record<string, unknown>): string | undefined {
  const direct = stringValue(record.message) ?? stringValue(record.error);
  if (direct) return direct;

  const error = asRecord(record.error);
  const nested = stringValue(error.message) ?? stringValue(error.error);
  if (nested) return nested;

  const structuredContent = asRecord(record.structuredContent);
  const structuredMessage = stringValue(structuredContent.message);
  if (structuredMessage) return structuredMessage;

  const content = Array.isArray(record.content) ? record.content : [];
  for (const entry of content) {
    const text = stringValue(asRecord(entry).text);
    if (text) return text;
  }

  return undefined;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
