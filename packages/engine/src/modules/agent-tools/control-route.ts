import type { AgentControlActionBody, PlanExecutionResult } from "@chrona/contracts";
import { submitTerminalNodeResult } from "@/modules/plan-execution/use-cases/submit-terminal-node-result";
import {
  ConflictingTerminalActionError,
  recordTerminalAction,
  validateRunToken,
  type RunTokenScope,
} from "@/modules/plan-execution/runtime/agent-control-store";
import {
  isTerminalControlKind,
  submitNodeResultActionFromControl,
} from "./node-result-action";

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

export async function handleControlAction(input: HandleControlActionInput): Promise<HandleControlActionResult> {
  const scope = await validateRunToken(input.token);
  if (!scope) {
    throw new ControlRouteError("token_invalid", 401, "Run token is missing, expired, or revoked");
  }
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

  const isRecordedTerminal = isTerminalControlKind(input.body.kind) && Boolean(scope.nodeAttemptId);
  let recorded = false;
  let alreadyAccepted = false;
  if (isRecordedTerminal) {
    try {
      const terminalRecord = await recordTerminalAction({
        scope: omitToken(scope),
        kind: input.body.kind,
        payload: input.body.payload ?? {},
        workspaceId: input.workspaceId,
      });
      recorded = terminalRecord.recorded;
      alreadyAccepted = !terminalRecord.recorded;
    } catch (error) {
      if (error instanceof ConflictingTerminalActionError) {
        throw new ControlRouteError(
          "conflicting_terminal_action",
          409,
          error.message,
        );
      }
      throw error;
    }
  }

  if (isRecordedTerminal) {
    return {
      ok: true,
      result: null,
      kind: input.body.kind,
      recorded,
      alreadyAccepted,
    };
  }

  const result = await submitTerminalNodeResult({
    taskId: scope.taskId,
    action,
  });

  return {
    ok: true,
    result,
    kind: input.body.kind,
    recorded: false,
    alreadyAccepted: false,
  };
}

function omitToken(scope: RunTokenScope): Omit<RunTokenScope, "token"> {
  const { token: _token, ...rest } = scope;
  void _token;
  return rest;
}