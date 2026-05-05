import type {
  OpenClawApprovalDecision,
  OpenClawChatHistory,
  OpenClawPendingApproval,
  OpenClawRunSnapshot,
} from "@chrona/providers-core";

type OpenClawSyncCursor = {
  sessionKey?: string;
  lastMessageSeq?: number;
  lastRunStatus?: string;
  approvalIds?: string[];
};

type OpenClawTimelineEvent = {
  eventType:
    | "approval.requested"
    | "approval.resolved"
    | "tool.called"
    | "tool.completed"
    | "run.completed"
    | "run.failed"
    | "human.input_requested";
  dedupeKey: string;
  payload: Record<string, unknown>;
  runtimeTs?: Date;
};

type OpenClawConversationEntry = {
  role: string;
  content: string;
  sequence: number;
  externalRef?: string;
  runtimeTs?: Date;
};

type OpenClawToolCallDetail = {
  externalRef: string;
  toolName: string;
  status: string;
  argumentsSummary?: string;
  resultSummary?: string;
  errorSummary?: string;
  runtimeTs?: Date;
};

type OpenClawApprovalRecord = {
  approvalId: string;
  type: string;
  title: string;
  summary: string;
  riskLevel: string;
  payload: Record<string, unknown>;
  requestedAt: Date;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readOpenClawMeta(message: Record<string, unknown>) {
  const meta = isRecord(message.__openclaw) ? message.__openclaw : null;
  const seq = meta && typeof meta.seq === "number" ? meta.seq : undefined;
  const id = meta ? readString(meta, "id") : undefined;

  return { seq, id };
}

function readTimestamp(value: unknown) {
  if (typeof value === "number") {
    return new Date(value);
  }

  if (typeof value === "string") {
    return new Date(value);
  }

  return undefined;
}

function readContentParts(message: Record<string, unknown>) {
  const content = message.content;
  if (Array.isArray(content)) {
    return content.filter((part): part is Record<string, unknown> => isRecord(part));
  }

  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  return [];
}

function joinText(parts: Array<Record<string, unknown>>) {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join("\n")
    .trim();
}

export function decodeSyncCursor(nextCursor?: string | null): OpenClawSyncCursor {
  if (!nextCursor) {
    return {};
  }

  try {
    const parsed = JSON.parse(nextCursor) as OpenClawSyncCursor;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function encodeSyncCursor(cursor: OpenClawSyncCursor) {
  return JSON.stringify(cursor);
}

export function mapHistoryDelta(input: {
  history: OpenClawChatHistory;
  cursor: OpenClawSyncCursor;
}) {
  const messages = [...input.history.messages].sort((left, right) => {
    const leftMeta = isRecord(left)
      ? readOpenClawMeta(left)
      : { seq: undefined as number | undefined, id: undefined as string | undefined };
    const rightMeta = isRecord(right)
      ? readOpenClawMeta(right)
      : { seq: undefined as number | undefined, id: undefined as string | undefined };
    return (leftMeta.seq ?? 0) - (rightMeta.seq ?? 0);
  });

  const conversationEntries: OpenClawConversationEntry[] = [];
  const toolCalls: OpenClawToolCallDetail[] = [];
  const events: OpenClawTimelineEvent[] = [];
  let lastMessageSeq = input.cursor.lastMessageSeq ?? 0;

  for (const message of messages) {
    if (!isRecord(message)) {
      continue;
    }

    const meta = readOpenClawMeta(message);
    if (!meta.seq || meta.seq <= (input.cursor.lastMessageSeq ?? 0)) {
      continue;
    }

    lastMessageSeq = Math.max(lastMessageSeq, meta.seq);
    const runtimeTs = readTimestamp(message.timestamp);
    const parts = readContentParts(message);
    const role = readString(message, "role") ?? "assistant";
    const textContent = joinText(parts);

    if ((role === "user" || role === "assistant") && textContent) {
      conversationEntries.push({
        role,
        content: textContent,
        sequence: meta.seq,
        externalRef: meta.id,
        runtimeTs,
      });
    }

    for (const part of parts) {
      if (part.type !== "toolCall") {
        continue;
      }

      const toolCallId = readString(part, "id");
      const toolName = readString(part, "name");
      if (!toolCallId || !toolName) {
        continue;
      }

      const argumentsSummary = part.arguments ? JSON.stringify(part.arguments) : undefined;
      toolCalls.push({
        externalRef: toolCallId,
        toolName,
        status: "called",
        argumentsSummary,
        runtimeTs,
      });
      events.push({
        eventType: "tool.called",
        dedupeKey: `tool.called:${toolCallId}`,
        payload: {
          tool_name: toolName,
          arguments_summary: argumentsSummary,
        },
        runtimeTs,
      });
    }

    if (role === "toolResult") {
      const toolCallId = readString(message, "toolCallId");
      const toolName = readString(message, "toolName") ?? "tool";
      if (!toolCallId) {
        continue;
      }

      const isError = message.isError === true;
      const resultSummary = textContent || undefined;
      toolCalls.push({
        externalRef: toolCallId,
        toolName,
        status: isError ? "failed" : "completed",
        resultSummary,
        errorSummary: isError ? resultSummary : undefined,
        runtimeTs,
      });
      events.push({
        eventType: "tool.completed",
        dedupeKey: `tool.completed:${toolCallId}`,
        payload: {
          tool_name: toolName,
          success: !isError,
          result_summary: resultSummary,
        },
        runtimeTs,
      });
    }
  }

  return { conversationEntries, toolCalls, events, lastMessageSeq };
}

export function mapApprovalDelta(input: {
  approvals: OpenClawPendingApproval[];
  cursor: OpenClawSyncCursor;
}) {
  const knownIds = new Set(input.cursor.approvalIds ?? []);
  const approvalIds = new Set<string>();
  const approvals: OpenClawApprovalRecord[] = [];
  const events: OpenClawTimelineEvent[] = [];

  for (const approval of input.approvals) {
    approvalIds.add(approval.approvalId);
    if (knownIds.has(approval.approvalId)) {
      continue;
    }

    const requestedAt = new Date(approval.createdAtMs ?? Date.now());
    const summary = approval.ask ?? approval.command ?? "Approval requested";
    approvals.push({
      approvalId: approval.approvalId,
      type: "exec_command",
      title: "Approval required",
      summary,
      riskLevel: "high",
      payload: {
        session_key: approval.sessionKey,
        host: approval.host,
        command: approval.command,
        ask: approval.ask,
        expires_at_ms: approval.expiresAtMs,
      },
      requestedAt,
    });
    events.push({
      eventType: "approval.requested",
      dedupeKey: `approval.requested:${approval.approvalId}`,
      payload: {
        approval_id: approval.approvalId,
        approval_type: "exec_command",
        title: "Approval required",
        summary,
        risk_level: "high",
      },
      runtimeTs: requestedAt,
    });
  }

  return {
    approvals,
    events,
    approvalIds: [...approvalIds].sort(),
  };
}

export function mapRunLifecycleEvent(input: {
  previousStatus?: string | null;
  snapshot: OpenClawRunSnapshot;
  runId: string;
}) {
  if (input.previousStatus === input.snapshot.status) {
    return null;
  }

  if (input.snapshot.status === "Completed") {
    return {
      eventType: "run.completed",
      dedupeKey: `run.completed:${input.runId}`,
      payload: {
        runtime_run_ref: input.snapshot.runtimeRunRef,
      },
      runtimeTs: undefined,
    } satisfies OpenClawTimelineEvent;
  }

  if (input.snapshot.status === "Failed") {
    return {
      eventType: "run.failed",
      dedupeKey: `run.failed:${input.runId}`,
      payload: {
        runtime_run_ref: input.snapshot.runtimeRunRef,
        error_summary: input.snapshot.lastMessage,
      },
      runtimeTs: undefined,
    } satisfies OpenClawTimelineEvent;
  }

  if (input.snapshot.status === "WaitingForInput") {
    return {
      eventType: "human.input_requested",
      dedupeKey: `human.input_requested:${input.runId}`,
      payload: {
        runtime_run_ref: input.snapshot.runtimeRunRef,
        prompt: input.snapshot.lastMessage,
      },
      runtimeTs: undefined,
    } satisfies OpenClawTimelineEvent;
  }

  return null;
}

export function mapApprovalResolution(input: {
  approvalId: string;
  decision: OpenClawApprovalDecision | null;
  resolvedAt?: Date;
}) {
  const resolvedAt = input.resolvedAt ?? new Date();

  if (input.decision === "deny") {
    return {
      status: "Rejected",
      resolution: "rejected",
      resolutionNote: "Resolved from OpenClaw approval decision sync",
      resolvedAt,
      event: {
        eventType: "approval.resolved",
        dedupeKey: `approval.resolved:${input.approvalId}`,
        payload: {
          approval_id: input.approvalId,
          resolution: "rejected",
          resolution_note: "Resolved from OpenClaw approval decision sync",
        },
        runtimeTs: resolvedAt,
      } satisfies OpenClawTimelineEvent,
    };
  }

  if (input.decision === "allow-once" || input.decision === "allow-always") {
    return {
      status: "Approved",
      resolution: "approved",
      resolutionNote: "Resolved from OpenClaw approval decision sync",
      resolvedAt,
      event: {
        eventType: "approval.resolved",
        dedupeKey: `approval.resolved:${input.approvalId}`,
        payload: {
          approval_id: input.approvalId,
          resolution: "approved",
          resolution_note: "Resolved from OpenClaw approval decision sync",
        },
        runtimeTs: resolvedAt,
      } satisfies OpenClawTimelineEvent,
    };
  }

  return {
    status: "Expired",
    resolution: "expired",
    resolutionNote: "Approval no longer pending upstream; exact decision unavailable",
    resolvedAt,
    event: {
      eventType: "approval.resolved",
      dedupeKey: `approval.resolved:${input.approvalId}`,
      payload: {
        approval_id: input.approvalId,
        resolution: "expired",
        resolution_note: "Approval no longer pending upstream; exact decision unavailable",
      },
      runtimeTs: resolvedAt,
    } satisfies OpenClawTimelineEvent,
  };
}
