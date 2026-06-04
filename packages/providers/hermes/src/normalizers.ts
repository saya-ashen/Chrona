import type {
  ProviderApprovalChoice,
  ProviderApprovalRequest,
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
  approval: {
    supported: true,
    choices: ["approve_once", "approve_session", "approve_always", "deny"],
    scopes: ["once", "session", "always"],
    resolveAll: true,
  },
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
  options: { includeRaw: boolean; strictUnknown?: boolean; sequence?: number; sessionId?: string },
): ProviderRunEvent | undefined {
  const body = asRecord(event);
  const type = stringValue(body.type) ?? stringValue(body.event);
  const metadata = buildEventMetadata({
    body,
    fallbackRunId: runId,
    sessionId: options.sessionId,
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
        approval: normalizeHermesApproval(event, metadata.runId ?? runId, metadata.sessionId),
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
          sessionId: metadata.sessionId ?? "unknown",
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
  sessionId?: string;
  sequence?: number;
}) {
  const rawEventType = stringValue(input.body.type) ?? stringValue(input.body.event);
  const timestampValue = stringValue(input.body.timestamp) ?? stringValue(input.body.time);
  const durationMs = numberValue(input.body.duration);
  return {
    provider: "hermes",
    runId: stringValue(input.body.run_id) ?? input.fallbackRunId,
    sessionId: input.sessionId,
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

function normalizeHermesApproval(
  event: unknown,
  runId: string,
  sessionId?: string,
): ProviderApprovalRequest {
  const body = asRecord(event);
  const providerKind = stringValue(body.pattern_key) ?? "provider_action";
  const command = stringValue(body.command);
  const description = stringValue(body.description);
  const choices = mapHermesApprovalChoices(body.choices);
  const kind = hermesApprovalKind(providerKind);
  const title = hermesApprovalTitle(providerKind);

  return {
    provider: "hermes",
    runId,
    nativeRunId: stringValue(body.run_id),
    sessionId,
    kind,
    providerKind,
    title,
    summary: hermesApprovalSummary(providerKind, command),
    description,
    riskLevel: hermesApprovalRisk(providerKind),
    subject: command
      ? {
          type: "command",
          label: providerKind,
          preview: command,
          language: detectApprovalCommandLanguage(command),
        }
      : undefined,
    choices,
    defaultChoice: choices.includes("approve_once") ? "approve_once" : undefined,
    recommendedChoice: choices.includes("approve_once") ? "approve_once" : undefined,
    scopePolicy: {
      supportsOnce: choices.includes("approve_once"),
      supportsSession: choices.includes("approve_session"),
      supportsAlways: choices.includes("approve_always"),
      supportsResolveAll: true,
    },
    raw: event,
  };
}

function mapHermesApprovalChoices(value: unknown): ProviderApprovalChoice[] {
  const source = Array.isArray(value) ? value : ["once", "session", "always", "deny"];
  const choices: ProviderApprovalChoice[] = [];
  for (const item of source) {
    switch (stringValue(item)) {
      case "once":
      case "approve":
      case "approved":
      case "allow":
        choices.push("approve_once");
        break;
      case "session":
        choices.push("approve_session");
        break;
      case "always":
        choices.push("approve_always");
        break;
      case "deny":
        choices.push("deny");
        break;
    }
  }
  return choices.length > 0 ? Array.from(new Set(choices)) : ["approve_once", "deny"];
}

function hermesApprovalKind(providerKind: string): string {
  switch (providerKind) {
    case "execute_code":
      return "tool_execution";
    case "shell_command":
      return "command_execution";
    case "network_access":
      return "network_access";
    case "file_write":
      return "file_write";
    default:
      return "provider_action";
  }
}

function hermesApprovalTitle(providerKind: string): string {
  switch (providerKind) {
    case "execute_code":
      return "Approve code execution";
    case "shell_command":
      return "Approve shell command";
    case "network_access":
      return "Approve network access";
    case "file_write":
      return "Approve file write";
    default:
      return "Approve provider action";
  }
}

function hermesApprovalSummary(providerKind: string, command?: string): string {
  const title = hermesApprovalTitle(providerKind);
  if (!command) {
    return title;
  }
  const firstLine = command.split("\n", 1)[0]?.trim();
  return firstLine ? `${title}: ${firstLine}` : title;
}

function hermesApprovalRisk(providerKind: string): ProviderApprovalRequest["riskLevel"] {
  switch (providerKind) {
    case "execute_code":
    case "shell_command":
      return "high";
    case "network_access":
    case "file_write":
      return "medium";
    default:
      return "unknown";
  }
}

function detectApprovalCommandLanguage(command: string): string | undefined {
  if (command.startsWith("execute_code <<'PY'") || command.startsWith("execute_code <<\"PY\"")) {
    return "python";
  }
  return undefined;
}
