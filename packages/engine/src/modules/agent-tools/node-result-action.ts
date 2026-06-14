import type { AgentControlActionBody, ChronaToolName, ChronaToolOperation } from "@chrona/contracts";
import type { AgentToolOperationsDeps } from "./types";

export type SubmitNodeResultAction = Parameters<AgentToolOperationsDeps["execution"]["submitNodeResult"]>[0]["action"];

export function submitNodeResultActionFromTool(input: {
  toolName: ChronaToolName;
  sessionId?: string;
  payload: unknown;
}): SubmitNodeResultAction | null {
  switch (input.toolName) {
    case "chrona.node.output": {
      const body = input.payload as { outputs: unknown; mode?: "append" | "replace"; summary?: string };
      return {
        action: "submit_node_output",
        sessionId: input.sessionId,
        outputs: body.outputs,
        mode: body.mode,
        summary: body.summary,
      };
    }
    case "chrona.node.complete":
    case "chrona.node.condition_select":
    case "chrona.node.wait_complete": {
      const body = input.payload as {
        summary?: string;
        nodeId?: string;
        branchRef?: string;
        decision?: "approved" | "rejected" | "needs_input" | "completed";
        feedback?: string;
        prompt?: string;
        input?: unknown;
        outputs?: unknown;
      };
      return {
        action: "complete_manual_node",
        sessionId: input.sessionId,
        nodeId: body.nodeId,
        summary: body.summary,
        output: body.input ?? body.outputs,
        terminalKind: input.toolName === "chrona.node.condition_select"
          ? "condition"
          : input.toolName === "chrona.node.wait_complete"
            ? "wait"
            : "task",
        branchRef: body.branchRef,
        decision: body.decision,
        feedback: body.feedback,
        prompt: body.prompt,
      };
    }
    case "chrona.node.block": {
      const body = input.payload as {
        reason: string;
        actionForm: NonNullable<Extract<SubmitNodeResultAction, { action: "block_current_node" }>["actionForm"]>;
      };
      return {
        action: "block_current_node",
        sessionId: input.sessionId,
        reason: body.reason,
        actionForm: body.actionForm,
      };
    }
    case "chrona.node.fail": {
      const body = input.payload as { error: string };
      return {
        action: "fail_current_node",
        sessionId: input.sessionId,
        error: body.error,
      };
    }
    default:
      return null;
  }
}

export function toolNameFromControlKind(kind: AgentControlActionBody["kind"]): ChronaToolName | null {
  switch (kind) {
    case "output":
      return "chrona.node.output";
    case "complete":
      return "chrona.node.complete";
    case "condition_select":
      return "chrona.node.condition_select";
    case "wait_complete":
      return "chrona.node.wait_complete";
    case "block":
      return "chrona.node.block";
    case "fail":
      return "chrona.node.fail";
    case "task_read":
      return "chrona.task.read";
    case "plan_read":
      return "chrona.plan.read";
    default:
      return null;
  }
}

export function submitNodeResultActionFromControl(input: {
  body: AgentControlActionBody;
  sessionId?: string;
}): SubmitNodeResultAction | null {
  const toolName = toolNameFromControlKind(input.body.kind);
  if (!toolName) return null;
  return submitNodeResultActionFromTool({
    toolName,
    sessionId: input.sessionId,
    payload: input.body.payload,
  });
}

export function controlKindFromToolName(toolName: ChronaToolName): AgentControlActionBody["kind"] | null {
  switch (toolName) {
    case "chrona.node.output":
      return "output";
    case "chrona.node.complete":
      return "complete";
    case "chrona.node.condition_select":
      return "condition_select";
    case "chrona.node.wait_complete":
      return "wait_complete";
    case "chrona.node.block":
      return "block";
    case "chrona.node.fail":
      return "fail";
    case "chrona.task.read":
      return "task_read";
    case "chrona.plan.read":
      return "plan_read";
    default:
      return null;
  }
}

export function isTerminalControlKind(kind: AgentControlActionBody["kind"]): boolean {
  return kind === "complete" || kind === "condition_select" || kind === "wait_complete" || kind === "block" || kind === "fail";
}

export type NodeResultToolOperation = Pick<ChronaToolOperation, "toolName" | "input">;
