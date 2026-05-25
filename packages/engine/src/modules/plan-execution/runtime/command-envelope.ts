import type {
  AdvanceRuntimeCommand,
  OrchestratorTrigger,
  PlanGraphCommandActor,
  PlanGraphCommandEnvelope,
  PlanGraphCommandOrigin,
} from "../types";

export function actorForTrigger(trigger: OrchestratorTrigger): PlanGraphCommandActor {
  if (trigger === "scheduler") {
    return { type: "system", service: "scheduler", reason: "scheduled execution" };
  }
  if (trigger === "auto") return { type: "agent" };
  if (trigger === "system") return { type: "system", service: "plan-execution" };
  return { type: "user" };
}

export function originForTrigger(trigger: OrchestratorTrigger): PlanGraphCommandOrigin {
  if (trigger === "scheduler") return { channel: "scheduler" };
  if (trigger === "auto") return { channel: "provider_stream" };
  if (trigger === "system") return { channel: "internal" };
  return { channel: "api" };
}

export function buildPlanGraphCommandEnvelope(input: {
  taskId: string;
  planId: string;
  mainSessionId: string;
  executionSessionId: string;
  command: AdvanceRuntimeCommand;
  trigger: OrchestratorTrigger;
  actor?: PlanGraphCommandActor;
  origin?: PlanGraphCommandOrigin;
  nodeAttemptId?: string | null;
  providerRunId?: string | null;
  toolInvocationId?: string | null;
  causationEventId?: string | null;
  causationRawEventId?: string | null;
}): PlanGraphCommandEnvelope {
  return {
    command: input.command,
    actor: input.actor ?? actorForTrigger(input.trigger),
    origin: input.origin ?? originForTrigger(input.trigger),
    correlation: {
      taskId: input.taskId,
      planId: input.planId,
      mainSessionId: input.mainSessionId,
      executionSessionId: input.executionSessionId,
      nodeAttemptId: input.nodeAttemptId ?? null,
      providerRunId: input.providerRunId ?? null,
      toolInvocationId: input.toolInvocationId ?? null,
      causationEventId: input.causationEventId ?? null,
      causationRawEventId: input.causationRawEventId ?? null,
    },
  };
}
