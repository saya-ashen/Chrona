import type {
  ChronaToolName,
  ChronaToolReasonCode,
  ChronaToolRecovery,
  ChronaToolResult,
} from "@chrona/contracts";

type ResultInput = {
  operationId: string;
  toolName: ChronaToolName;
  message: string;
  affected?: ChronaToolResult["affected"];
  state?: ChronaToolResult["state"];
  auditRef?: string | null;
  recovery?: ChronaToolRecovery | null;
  evidence?: Record<string, unknown>;
};

function completedAt() {
  return new Date().toISOString();
}

function baseResult(input: ResultInput): Omit<ChronaToolResult, "status" | "reasonCode" | "idempotency"> {
  return {
    operationId: input.operationId,
    toolName: input.toolName,
    message: input.message,
    affected: input.affected ?? {},
    state: input.state ?? {},
    auditRef: input.auditRef ?? null,
    recovery: input.recovery ?? null,
    completedAt: completedAt(),
    ...(input.evidence ? { evidence: input.evidence } : {}),
  };
}

export function acceptedToolResult(input: ResultInput): ChronaToolResult {
  return {
    ...baseResult(input),
    status: "accepted",
    reasonCode: null,
    idempotency: "new",
  };
}

export function noopToolResult(input: ResultInput): ChronaToolResult {
  return {
    ...baseResult(input),
    status: "noop",
    reasonCode: null,
    idempotency: "not_applicable",
  };
}

export function duplicateOperationToolResult(input: ResultInput): ChronaToolResult {
  return {
    ...baseResult(input),
    status: "noop",
    reasonCode: "DUPLICATE_OPERATION",
    idempotency: "replayed",
  };
}

export function rejectedToolResult(input: ResultInput & {
  reasonCode: ChronaToolReasonCode;
}): ChronaToolResult {
  return {
    ...baseResult(input),
    status: "rejected",
    reasonCode: input.reasonCode,
    idempotency: "new",
  };
}

export function validationErrorToolResult(input: ResultInput): ChronaToolResult {
  return rejectedToolResult({
    ...input,
    reasonCode: "VALIDATION_ERROR",
  });
}

export function staleStateToolResult(input: ResultInput): ChronaToolResult {
  return rejectedToolResult({
    ...input,
    reasonCode: "STALE_STATE",
  });
}
