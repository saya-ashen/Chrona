import { runtimeCompletionSchema, runtimeOutcomeSchema } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "../ports";
import { providerCompletionBudgetSchema, runProviderBinding } from "./agent-provider";
import { maskProviderPayload } from "./agent-provider-redaction";
import { CallError } from "../modules/module-call-error";
import { finishCompletionIn, type ModelError } from "../modules/module-model-budget";
import { appendRunEventIn } from "../execution/run-events";

type Outcome = ReturnType<typeof runtimeOutcomeSchema.parse>;
type Completion = ReturnType<typeof runtimeCompletionSchema.parse>;
type Observation = { result: unknown } | { outcome: Outcome };
type Settlement = { outcome: Outcome; result?: Completion; error: ModelError | null };
const failed = (error: string): Settlement => ({ outcome: { outcome: "failed", sessionId: null, error }, error: "provider_error" });

function retainedCompletion(observation: Observation, maxOutputTokens: number, secrets: string[]): Settlement {
  if ("outcome" in observation) {
    if (observation.outcome.outcome === "finished") throw new CallError("unknown", "Provider finished without a retained completion result");
    return { outcome: observation.outcome, error: observation.outcome.outcome === "timed_out" ? "timeout" : "provider_error" };
  }
  const parsed = runtimeCompletionSchema.safeParse(observation.result);
  if (!parsed.success) return failed("Invalid provider completion result");
  if (parsed.data.outputTokens !== null && parsed.data.outputTokens > maxOutputTokens) return failed("Provider exceeded completion output budget");
  try {
    const result = runtimeCompletionSchema.parse(maskProviderPayload(parsed.data, secrets));
    return { outcome: { outcome: "finished", sessionId: null, error: null }, result, error: null };
  } catch (error) {
    if (!(error instanceof CallError) || error.code !== "invalid") throw error;
    return failed("Provider completion result could not be retained");
  }
}

/** One writer transaction owns both the retained result and its original caller's accounting. */
export async function settleRunCompletion(ports: StewardPorts, workspaceId: string, runId: string, observation: Observation,
  secrets: string[] = []): Promise<Outcome> {
  return ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
    const binding = await tx.agentRunProvider.findFirst({ where: { runId, run: { workspaceId } } });
    if (binding?.kind !== "completion") throw new CallError("conflict", "Run is not bound to a completion");
    const budget = providerCompletionBudgetSchema.parse(binding.completion);
    const owner = await tx.agentRunAdmission.findUnique({ where: { runId } });
    if (!owner) throw new CallError("conflict", "Completion admission is missing");
    const expectedOwner = { moduleId: owner.moduleId, hash: owner.hash };
    const reservation = await tx.moduleCall.findFirst({ where: { id: budget.reservationId, method: "model", workspaceId, module: {
      workspaceId }, ...expectedOwner } });
    if (!reservation || !["pending", "executed", "failed"].includes(reservation.status)) throw new CallError("conflict",
      "Completion reservation does not match its admission");
    if (reservation.status === "executed") {
      const event = await tx.runEvent.findFirst({ where: { runId, kind: "completion" } });
      if (!event) throw new CallError("conflict", "Settled completion result is missing");
      return { outcome: "finished", sessionId: null, error: null };
    }
    if (reservation.status === "failed") return { outcome: reservation.error === "timeout" ? "timed_out" : "failed", sessionId: null,
      error: "Provider completion failed" };
    const settled = retainedCompletion(observation, Math.min(budget.maxOutputTokens, budget.limits.maxOutputTokens), secrets);
    if (settled.result) await appendRunEventIn(tx, runId, "completion", settled.result as Prisma.InputJsonValue, ports.now());
    await finishCompletionIn(tx, workspaceId, { id: budget.reservationId, result: settled.result, error: settled.error }, expectedOwner);
    return settled.outcome;
  });
}

/** A finished completion without its result remains unknown, even when the Provider has exited. */
export async function settleRunProviderStatus(ports: StewardPorts, workspaceId: string, runId: string, raw: unknown): Promise<Outcome | null> {
  if (!raw || typeof raw !== "object" || !("outcome" in raw)) return null;
  const outcome = runtimeOutcomeSchema.safeParse(raw.outcome);
  if (!outcome.success) return null;
  const binding = await runProviderBinding(ports, workspaceId, runId);
  if (binding.kind !== "completion") return outcome.data;
  if (!("operationId" in raw) || raw.operationId !== runId) return null;
  if (outcome.data.outcome !== "finished") return settleRunCompletion(ports, workspaceId, runId, { outcome: outcome.data });
  if (!("completion" in raw) || raw.completion == null) return null;
  return settleRunCompletion(ports, workspaceId, runId, { result: raw.completion });
}
