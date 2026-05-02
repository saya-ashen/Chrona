import type { TaskPlanNode, TaskPlanGraph, PlanUpdatePatch } from "@/modules/ai/types";
import type { NodeSessionDecision } from "./session-policy";
import { ensureNodeChildSession, startNodeChildRun } from "./node-child-session";
import { createRuntimeExecutionAdapter } from "@/modules/task-execution/execution-registry";
import { db } from "@/lib/db";

export type NodeExecutionEvidence = {
  sessionId?: string;
  runId?: string;
  childTaskId?: string;
  childSessionId?: string;
  artifactIds?: string[];
  conversationEntryIds?: string[];
  eventIds?: string[];
};

export type NodeExecutionResult =
  | {
      status: "done";
      summary: string;
      evidence: NodeExecutionEvidence;
      output?: unknown;
    }
  | {
      status: "waiting_for_user";
      prompt: string;
      reason: string;
      evidence?: NodeExecutionEvidence;
    }
  | {
      status: "waiting_for_approval";
      prompt: string;
      reason: string;
      evidence?: NodeExecutionEvidence;
    }
  | {
      status: "blocked";
      reason: string;
      evidence?: NodeExecutionEvidence;
    }
  | {
      status: "replan_required";
      reason: string;
      evidence?: NodeExecutionEvidence;
      proposedPatch?: PlanUpdatePatch;
    }
  | {
      status: "child_running";
      summary: string;
      evidence: NodeExecutionEvidence;
      output?: unknown;
    }
  | {
      status: "failed";
      error: string;
      evidence?: NodeExecutionEvidence;
    };

export type NodeExecutorInput = {
  taskId: string;
  planId: string;
  mainSession: {
    id: string;
    taskId: string;
    sessionKey: string;
  };
  node: TaskPlanNode;
  plan: TaskPlanGraph;
  sessionDecision: NodeSessionDecision;
  trigger: "manual" | "scheduler" | "system" | "auto";
};

function buildInstructions(input: NodeExecutorInput): string {
  const completedNodes = input.plan.nodes
    .filter((n) => n.status === "done" || n.status === "skipped")
    .map((n) => n.title);

  return [
    `Task: ${input.plan.summary ?? "Execute plan node"}`,
    `Current node: [${input.node.id}] ${input.node.title}`,
    `Objective: ${input.node.objective}`,
    completedNodes.length > 0
      ? `Already completed: ${completedNodes.join(", ")}`
      : "",
    "IMPORTANT: Return the node status as one of: done, waiting_for_user, blocked, replan_required.",
    "Do NOT skip steps that require human input.",
    "Do NOT fabricate user input.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function executePlanNode(
  input: NodeExecutorInput,
): Promise<NodeExecutionResult> {
  const { node, sessionDecision } = input;

  // Guard: already done
  if (node.status === "done" || node.status === "skipped") {
    return {
      status: "done",
      summary: node.completionSummary ?? `Node ${node.id} was already completed`,
      evidence: {},
    };
  }

  // Ensure in_progress marker
  if (node.status !== "in_progress") {
    return {
      status: "blocked",
      reason: `Node ${node.id} status is ${node.status}, must be set to in_progress before execution`,
      evidence: {},
    };
  }

  switch (sessionDecision.kind) {
    case "wait_for_user":
      return {
        status: "waiting_for_user",
        prompt: `Please provide input for: ${node.objective}`,
        reason: sessionDecision.reason,
        evidence: { sessionId: input.mainSession.id },
      };

    case "manual_only":
      return {
        status: "blocked",
        reason: sessionDecision.reason,
        evidence: { sessionId: input.mainSession.id },
      };

    case "child_session": {
      const instructions = buildInstructions(input);

      let childSessionId: string | undefined;
      let childRunId: string | undefined;
      let childTaskId: string | undefined;

      try {
        const childSession = await ensureNodeChildSession({
          taskId: input.taskId,
          planId: input.planId,
          nodeId: node.id,
          nodeTitle: node.title,
          runtimeName: input.mainSession.sessionKey.includes("openclaw") ? "openclaw" : undefined,
        });

        childSessionId = childSession.sessionId;
        childTaskId = childSession.childTaskId;

        if (!childSession.runId) {
          const childRun = await startNodeChildRun({
            taskId: input.taskId,
            childSessionId: childSession.sessionId,
            childSessionKey: childSession.sessionKey,
            prompt: instructions,
            runtimeName: input.mainSession.sessionKey.includes("openclaw") ? "openclaw" : undefined,
          });
          childRunId = childRun.runId;
        } else {
          childRunId = childSession.runId;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start child run";
        return {
          status: "failed",
          error: `Failed to start child execution for node ${node.id}: ${message}`,
          evidence: { sessionId: input.mainSession.id },
        };
      }

      // Check if the child run completed synchronously (has assistant output)
      if (childRunId) {
        const hasAssistant = await db.conversationEntry.findFirst({
          where: { runId: childRunId, role: "assistant" },
          select: { id: true },
        });
        if (hasAssistant) {
          return {
            status: "done",
            summary: `Node ${node.id}: ${node.title} completed via child session`,
            evidence: {
              sessionId: input.mainSession.id,
              childSessionId,
              runId: childRunId,
              childTaskId,
            },
            output: { instructions },
          };
        }
      }

      return {
        status: "child_running",
        summary: `Child execution started for node ${node.id}: ${node.title} (async)`,
        evidence: {
          sessionId: input.mainSession.id,
          childSessionId,
          runId: childRunId,
          childTaskId,
        },
        output: {
          instructions,
          pendingChildExecution: true,
        },
      };
    }

    case "main_session": {
      const instructions = buildInstructions(input);

      try {
        const { RunStatus } = await import("@/generated/prisma/client");

        const run = await db.run.create({
          data: {
            taskId: input.taskId,
            taskSessionId: input.mainSession.id,
            runtimeName: "openclaw",
            runtimeSessionRef: input.mainSession.sessionKey,
            status: RunStatus.Pending,
            triggeredBy: "system",
            startedAt: new Date(),
            syncStatus: "healthy",
          },
        });

        const adapter = await createRuntimeExecutionAdapter("openclaw");
        const created = await adapter.createRun({
          prompt: instructions,
          runtimeInput: {},
          runtimeSessionKey: input.mainSession.sessionKey,
        });

        if (!created.runStarted) {
          await db.run.update({
            where: { id: run.id },
            data: { status: RunStatus.Failed, syncStatus: "healthy" },
          });
          return {
            status: "failed",
            error: `Runtime refused to start main session run for node ${node.id}`,
            evidence: { sessionId: input.mainSession.id, runId: run.id },
          };
        }

        // Persist the runtime output immediately — the adapter's in-memory sessions
        // are lost when this function returns, so we must read output now.
        const history = await adapter.readHistory({ runtimeSessionKey: input.mainSession.sessionKey }) as {
          messages?: Array<{ role?: string; content?: string }>;
        };

        let runStatus: (typeof RunStatus)[keyof typeof RunStatus] = RunStatus.Completed;
        let totalSaved = 0;
        let hasAssistantOutput = false;

        if (history?.messages?.length) {
          for (let i = 0; i < history.messages.length; i++) {
            const msg = history.messages[i];
            if (typeof msg?.role === "string" && typeof msg?.content === "string" && msg.content.length > 0) {
              await db.conversationEntry.create({
                data: {
                  runId: run.id,
                  role: msg.role,
                  content: msg.content,
                  sequence: i + 1,
                  runtimeTs: new Date(),
                },
              });
              totalSaved++;
              if (msg.role === "assistant") {
                hasAssistantOutput = true;
              }
            }
          }
        }

        if (totalSaved === 0 || !hasAssistantOutput) {
          runStatus = RunStatus.Failed;
        }

        await db.run.update({
          where: { id: run.id },
          data: {
            runtimeRunRef: created.runtimeRunRef ?? null,
            status: runStatus,
            syncStatus: "healthy",
          },
        });

        return {
          status: "done",
          summary: `Started node ${node.id} execution in main session`,
          evidence: {
            sessionId: input.mainSession.id,
            runId: run.id,
            conversationEntryIds: [],
          },
          output: {
            instructions,
            runId: run.id,
            runtimeRunRef: created.runtimeRunRef,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start main session run";
        return {
          status: "failed",
          error: `Failed to start main session execution for node ${node.id}: ${message}`,
          evidence: { sessionId: input.mainSession.id },
        };
      }
    }

    default:
      return {
        status: "failed",
        error: `Unknown session decision kind: ${(sessionDecision as { kind: string }).kind}`,
      };
  }
}
