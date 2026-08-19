import type { AgentControlActionBody, PlanExecutionResult } from "@chrona/contracts";
import { submitTerminalNodeResult } from "@/modules/plan-execution/use-cases/submit-terminal-node-result";
import {
  ConflictingTerminalActionError,
  latestRecordedTerminalAction,
  recordTerminalAction,
  revokeRunToken,
  validateRevokedRunToken,
  validateRunToken,
  type RunTokenScope,
} from "@/modules/plan-execution/runtime/agent-control-store";
import {
  isTerminalControlKind,
  submitNodeResultActionFromControl,
} from "./node-result-action";
import { abortActiveRuntimeInvocations } from "@/modules/plan-execution/runtime/active-runtime-invocations";

export class ControlRouteError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ControlRouteError";
    this.code = code;
    this.status = status;
  }
}
export type HandleControlActionInput = {
  token: string;
  body: AgentControlActionBody;
  workspaceId: string;
};

export type HandleControlActionResult = {
  ok: true;
  result: PlanExecutionResult | null;
  kind: AgentControlActionBody["kind"];
  recorded: boolean;
  alreadyAccepted: boolean;
};

async function resolveControlScope(input: HandleControlActionInput): Promise<{
  activeScope: RunTokenScope | null;
  scope: RunTokenScope;
}> {
  const activeScope = await validateRunToken(input.token);
  const scope = activeScope ?? await validateRevokedRunToken(input.token);
  if (!scope || scope.workspaceId !== input.workspaceId) {
    throw new ControlRouteError("token_invalid", 401, "Run token is missing, expired, or revoked");
  }
  return { activeScope, scope };
}

function actionFromControl(input: HandleControlActionInput, scope: RunTokenScope) {
  const action = submitNodeResultActionFromControl({
    body: input.body,
    sessionId: scope.taskSessionId ?? undefined,
  });
  if (!action) {
    throw new ControlRouteError(
      "unsupported_kind",
      400,
      `Control kind '${input.body.kind}' does not map to a node result action`,
    );
  }
  if (input.body.kind === "task_read" || input.body.kind === "plan_read") {
    throw new ControlRouteError(
      "read_not_supported",
      400,
      `Control kind '${input.body.kind}' is not a node action`,
    );
  }
  return action;
}

async function replayRecordedTerminalAction(
  input: HandleControlActionInput,
  scope: RunTokenScope,
): Promise<HandleControlActionResult> {
  const existing = await latestRecordedTerminalAction({
    runId: scope.runId,
    nodeAttemptId: scope.nodeAttemptId,
  });
  if (!existing) {
    throw new ControlRouteError("token_invalid", 401, "Run token is missing, expired, or revoked");
  }
  if (existing.kind !== input.body.kind) {
    throw new ControlRouteError(
      "conflicting_terminal_action",
      409,
      `Terminal action '${existing.kind}' was already recorded for this node attempt; cannot record '${input.body.kind}'`,
    );
  }
  abortTerminalInvocation(scope);
  return {
    ok: true,
    result: null,
    kind: input.body.kind,
    recorded: false,
    alreadyAccepted: true,
  };
}

async function recordTerminalActionAndRevoke(
  input: HandleControlActionInput,
  scope: RunTokenScope,
): Promise<HandleControlActionResult> {
  try {
    const terminalRecord = await recordTerminalAction({
      scope: omitToken(scope),
      kind: input.body.kind,
      payload: input.body.payload,
      workspaceId: input.workspaceId,
    });
    await revokeRunToken(input.token);
    abortTerminalInvocation(scope);
    return {
      ok: true,
      result: null,
      kind: input.body.kind,
      recorded: terminalRecord.recorded,
      alreadyAccepted: !terminalRecord.recorded,
    };
  } catch (error) {
    if (error instanceof ConflictingTerminalActionError) {
      throw new ControlRouteError("conflicting_terminal_action", 409, error.message);
    }
    throw error;
  }
}

export async function handleControlAction(input: HandleControlActionInput): Promise<HandleControlActionResult> {
  const { activeScope, scope } = await resolveControlScope(input);
  const isRecordedTerminal = isTerminalControlKind(input.body.kind) && Boolean(scope.nodeAttemptId);
  if (isRecordedTerminal) {
    return activeScope
      ? recordTerminalActionAndRevoke(input, scope)
      : replayRecordedTerminalAction(input, scope);
  }
  if (!activeScope) {
    throw new ControlRouteError("token_invalid", 401, "Run token is missing, expired, or revoked");
  }
  const action = actionFromControl(input, scope);
  const { sessionId, ...publicAction } = action;
  const result = await submitTerminalNodeResult({
    taskId: scope.taskId,
    commandContext: {
      sessionId: sessionId ?? undefined,
      runId: scope.runId,
      nodeAttemptId: scope.nodeAttemptId,
      providerRunId: scope.providerRunId,
    },
    action: publicAction,
  });
  return {
    ok: true,
    result,
    kind: input.body.kind,
    recorded: false,
    alreadyAccepted: false,
  };
}

function abortTerminalInvocation(scope: RunTokenScope) {
  if (!scope.nodeAttemptId) return;
  abortActiveRuntimeInvocations({
    runId: scope.runId,
    nodeAttemptId: scope.nodeAttemptId,
  });
}

function omitToken(scope: RunTokenScope): Omit<RunTokenScope, "token"> {
  const { token: _token, ...rest } = scope;
  void _token;
  return rest;
}