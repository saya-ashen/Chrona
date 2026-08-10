/* eslint-disable complexity, @typescript-eslint/no-unnecessary-condition -- Action execution defensively validates persisted and provider-owned state. */
import type {
  AiFeatureRuntimeError,
  AiObservationEnvelope,
  AiJsonObject,
  AiContractRef,
} from "@chrona/contracts/ai-feature-runtime";
import type { AiFeatureDefinition, AiFeatureActionContext } from "./define-feature";
import { findInvokeActionDefinition } from "./action-registry";
import { validateActionOutputObservation } from "./observation-registry";
import type {
  AiFeatureActionExecutionPort,
  AiFeatureRunActionRecord,
  AiFeatureRunRecord,
  AiFeatureRunRepositoryPort,
} from "./run-repository";
import { stableJsonHash } from "./stable-json";

export type AiFeatureActionExecutionFailure = {
  code: "action_not_allowed" | "action_input_invalid" | "action_duplicate" | "action_persistence_error" | "action_execution_error" | "action_outcome_unknown";
  message: string;
};

export type AiFeatureActionExecutionResult =
  | { ok: true; action: AiFeatureRunActionRecord; run: AiFeatureRunRecord; outputObservation: AiObservationEnvelope }
  | { ok: false; error: AiFeatureActionExecutionFailure };

/** The runner fences outcomes if its renewing lease is lost while an action waits. */
export type AiFeatureLeaseGuard = {
  await<T>(operation: () => Promise<T>, options?: { confirmAfter?: boolean }): Promise<T | undefined>;
  currentRun(): AiFeatureRunRecord | null;
};

/**
 * Claims an action durably before execution. Its completed output observation
 * is atomically stored with the run before the provider may see a tool result.
 */
export async function executeAiFeatureAction(input: {
  definition: AiFeatureDefinition;
  runs: AiFeatureRunRepositoryPort;
  executor?: AiFeatureActionExecutionPort;
  run: AiFeatureRunRecord;
  leaseOwner: string;
  leaseExpiresAt: string;
  workspaceId: string;
  subject: { type: string; id: string; revision?: string };
  action: AiContractRef;
  callId: string;
  input: AiJsonObject;
  observations: readonly AiObservationEnvelope[];
  now: string;
  lease?: AiFeatureLeaseGuard;
}): Promise<AiFeatureActionExecutionResult> {
  const definition = findInvokeActionDefinition(input.definition.actions, input.action);
  const binding = input.definition.manifest.actions.find(({ action }) => action.id === input.action.id && action.version === input.action.version);
  if (!definition || !binding || binding.mode !== "invoke") return { ok: false, error: { code: "action_not_allowed", message: "Invoke action is not declared by the feature." } };
  if (definition.inputSchema && !definition.inputSchema.safeParse(input.input).success) return { ok: false, error: { code: "action_input_invalid", message: "Invoke action input does not satisfy its contract." } };
  if (binding.executionSemantics === "shared_transaction" && !input.executor) return { ok: false, error: { code: "action_execution_error", message: "Shared-transaction actions require an atomic action executor." } };

  const executionKey = `${input.run.id}:invoke:${input.callId}`;
  const claimed = await input.runs.claimAction({
    id: `${input.run.id}:action:${input.callId}`,
    runId: input.run.id,
    callId: input.callId,
    executionKey,
    action: input.action,
    input: input.input,
    inputHash: stableJsonHash(input.input),
    executionSemantics: binding.executionSemantics,
    expectedRunStateVersion: input.run.stateVersion,
    leaseOwner: input.leaseOwner,
    leaseExpiresAt: input.leaseExpiresAt,
    maxCalls: binding.maxCalls,
    now: input.now,
  });
  if (!claimed) return { ok: false, error: { code: "action_persistence_error", message: "Action claim was rejected by durable run state." } };
  if (claimed?.kind === "outcome_unknown") return { ok: false, error: { code: "action_outcome_unknown", message: "An at-most-once action expired before its outcome was durable; reconciliation is required." } };
  if (claimed.action.inputHash !== stableJsonHash(input.input)) return { ok: false, error: { code: "action_duplicate", message: "Action call was reused with different input." } };
  if (claimed.action.runId !== input.run.id || claimed.action.callId !== input.callId || claimed.action.action.id !== input.action.id || claimed.action.action.version !== input.action.version) {
    return { ok: false, error: { code: "action_duplicate", message: "Action call was reused with a different action contract." } };
  }
  if (claimed.kind === "existing") {
    if (claimed.action.status === "completed" && claimed.action.outputObservation) {
      const outputObservation = validateActionOutputObservation({ observation: claimed.action.outputObservation, bindings: input.definition.manifest.observations, action: input.action });
      if (!outputObservation) return { ok: false, error: { code: "action_execution_error", message: "Completed action contains an invalid output observation." } };
      const recoveredRun = await input.runs.getById(input.run.id);
      if (!recoveredRun) return { ok: false, error: { code: "action_persistence_error", message: "Completed action has no recoverable run state." } };
      return { ok: true, action: claimed.action, run: recoveredRun, outputObservation };
    }
    if (claimed.action.status === "failed") return { ok: false, error: { code: "action_execution_error", message: claimed.action.error?.message ?? "Action execution previously failed." } };
    return { ok: false, error: { code: "action_outcome_unknown", message: claimed.action.status === "outcome_unknown" ? "An at-most-once action requires durable reconciliation." : "An action side effect is already executing; its outcome must be recovered before retry." } };
  }

  const failDurably = (error: AiFeatureRuntimeError) => {
    const persist = () => input.runs.failAction({ actionId: claimed.action.id, executionKey, leaseOwner: input.leaseOwner, error });
    return input.lease ? input.lease.await(persist) : persist();
  };

  try {
    const execute = async () => input.executor
      ? input.executor.execute({ runId: input.run.id, action: claimed.action, workspaceId: input.workspaceId, subject: input.subject, observations: input.observations })
      : definition.execute
        ? definition.execute({ workspaceId: input.workspaceId, subject: input.subject, featureInput: input.run.input, actionInput: input.input, callId: input.callId, executionKey, observations: input.observations } satisfies AiFeatureActionContext)
        : undefined;
    const output = input.lease ? await input.lease.await(execute) : await execute();
    const activeRun = input.lease?.currentRun() ?? input.run;
    if (!activeRun) return { ok: false, error: { code: "action_outcome_unknown", message: "Action completion was discarded after its run lease was lost." } };
    const outputObservation = validateActionOutputObservation({ observation: output, bindings: input.definition.manifest.observations, action: input.action });
    if (!outputObservation) {
      const error: AiFeatureRuntimeError = { code: "action_output_invalid", message: "Action output does not satisfy its observation contract." };
      const failed = await failDurably(error);
      return failed
        ? { ok: false, error: { code: "action_execution_error", message: error.message } }
        : { ok: false, error: { code: "action_outcome_unknown", message: "Action output was invalid but its durable failure could not be confirmed." } };
    }
    const complete = () => input.runs.completeAction({ actionId: claimed.action.id, executionKey, expectedRunStateVersion: activeRun.stateVersion, leaseOwner: input.leaseOwner, outputObservation });
    const completed = input.lease ? await input.lease.await(complete) : await complete();
    if (!completed) return { ok: false, error: { code: "action_outcome_unknown", message: "Action side effect completed but its durable outcome could not be confirmed." } };
    return { ok: true, action: completed.action, run: completed.run, outputObservation };
  } catch {
    const error: AiFeatureRuntimeError = { code: "internal_error", message: "Invoke action execution failed." };
    if (input.lease && !input.lease.currentRun()) return { ok: false, error: { code: "action_outcome_unknown", message: "Action failure was discarded after its run lease was lost." } };
    const failed = await failDurably(error).catch(() => undefined);
    return failed
      ? { ok: false, error: { code: "action_execution_error", message: error.message } }
      : { ok: false, error: { code: "action_outcome_unknown", message: "Action failure could not be confirmed durably." } };
  }
}
