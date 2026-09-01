/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Runtime recovery validates persisted values that may predate current static types. */
import { randomUUID } from "node:crypto";
import type { AiFeatureDefinition } from "../../feature-runtime/define-feature";
import { AiFeatureDefinitionRegistry } from "../../feature-runtime/definition-registry";
import { executeAiFeatureRunById, startOrAttachAiFeatureRun, type RunAiFeatureInput } from "../../feature-runtime/feature-runner";
import { classifyAiFeatureProviderError } from "../../feature-runtime/feature-compiler";
import type { AiFeatureRunRecord } from "../../feature-runtime/run-repository";
import { FoundationProviderRuntime, type FoundationProviderBinding } from "./foundation-provider-runtime";
import { PrismaAiFeatureRunStore } from "./prisma-run-store";
import { db, type Prisma } from "@chrona/db";

const activeStatuses = new Set(["queued", "preparing_observations", "starting_provider", "running", "validating", "committing_result"]);
export type DefaultAiFeatureRunInput = Omit<RunAiFeatureInput, "definition"> & { definition: AiFeatureDefinition };

/** Creates or reads a durable queued run without requiring provider availability. */
export async function startAiFeatureWithRuntime(
  input: DefaultAiFeatureRunInput,
  client?: Prisma.TransactionClient,
): Promise<{ runId: string }> {
  const runs = new PrismaAiFeatureRunStore(client);
  const run = await startOrAttachAiFeatureRun(input, {
    runs,
    ids: { next: randomUUID },
  });
  return { runId: run.id };
}

export async function runAiFeatureWithRuntime(
  input: DefaultAiFeatureRunInput,
  options: { signal?: AbortSignal; providerBinding?: FoundationProviderBinding } = {},
): Promise<AiFeatureRunRecord> {
  const runId = options.providerBinding
    ? await db.$transaction(async (tx) => {
        const started = await startAiFeatureWithRuntime(input, tx);
        await new PrismaAiFeatureRunStore(tx).pinProviderBinding({
          runId: started.runId,
          ...options.providerBinding!,
        });
        return started.runId;
      })
    : (await startAiFeatureWithRuntime(input)).runId;
  const runs = new PrismaAiFeatureRunStore();
  const persisted = await runs.getById(runId);
  if (!persisted) throw new Error(`AI Feature Run '${runId}' does not exist.`);
  const persistedBinding = persistedProviderBinding(persisted);
  let provider: FoundationProviderRuntime;
  try {
    provider = await new FoundationProviderRuntime(
      input.definition.providerBindingFeature,
      undefined,
      options.signal,
    ).initialize(persistedBinding ?? options.providerBinding);
    await runs.pinProviderBinding({ runId, ...provider.providerBinding() });
  } catch (cause) {
    const errorMessage = cause instanceof Error ? cause.message : "AI Provider initialization failed.";
    const failed = await runs.update({
      runId,
      expectedStateVersion: persisted.stateVersion,
      status: "failed",
      error: {
        code: classifyAiFeatureProviderError(errorMessage),
        message: errorMessage,
      },
      finishedAt: new Date().toISOString(),
    });
    return failed ?? (await runs.getById(runId)) ?? persisted;
  }
  return executeAiFeatureRunById(
    { definition: input.definition, runId },
    { runs, provider, ids: { next: randomUUID } },
  );
}


function persistedProviderBinding(run: AiFeatureRunRecord): FoundationProviderBinding | null {
  const values = [run.providerClientId, run.providerName, run.providerConfigFingerprint];
  if (values.every((value) => typeof value === "string" && value.length > 0)) {
    return {
      providerClientId: run.providerClientId!,
      providerName: run.providerName!,
      providerConfigFingerprint: run.providerConfigFingerprint!,
    };
  }
  if (values.some((value) => value !== undefined)) {
    throw new Error(`AI Feature Run '${run.id}' has an incomplete provider binding.`);
  }
  return null;
}
export async function resumeAiFeatureRun(input: {
  runId: string;
  definitions: AiFeatureDefinitionRegistry;
  signal?: AbortSignal;
}): Promise<AiFeatureRunRecord | null> {
  const runs = new PrismaAiFeatureRunStore();
  const run = await runs.getById(input.runId);
  if (!run || !activeStatuses.has(run.status)) return run;
  const definition = input.definitions.get(run.feature);
  if (!definition) return run;
  const expectedBinding = persistedProviderBinding(run);
  if (run.providerRunRef && !expectedBinding) {
    throw new Error(`AI Feature Run '${run.id}' cannot recover without its original provider binding.`);
  }
  const provider = await new FoundationProviderRuntime(
    definition.providerBindingFeature,
    undefined,
    input.signal,
  ).initialize(expectedBinding ?? undefined);
  await runs.pinProviderBinding({ runId: run.id, ...provider.providerBinding() });
  return executeAiFeatureRunById({ definition, runId: run.id }, { runs, provider, ids: { next: randomUUID } });
}

export async function recoverAiFeatureRuns(input: { definitions: AiFeatureDefinitionRegistry; limit?: number; now?: Date }): Promise<AiFeatureRunRecord[]> {
  const runs = new PrismaAiFeatureRunStore();
  const recoveryTime = input.now ?? new Date();
  const queuedBefore = new Date(recoveryTime.getTime() - 5_000);
  const recoverable = await runs.listRecoverableRuns(recoveryTime.toISOString(), queuedBefore.toISOString(), input.limit ?? 25);
  const recovered: AiFeatureRunRecord[] = [];
  for (const run of recoverable) {
    const result = await resumeAiFeatureRun({ runId: run.id, definitions: input.definitions });
    if (result) recovered.push(result);
  }
  return recovered;
}

export type AiFeatureRecoveryWorker = {
  tick(): Promise<void>;
  stop(): Promise<void>;
};

/** Continuously claims queued, released, or expired-lease runs after process restarts. */
export function startAiFeatureRecoveryWorker(input: {
  definitions: AiFeatureDefinitionRegistry;
  intervalMs?: number;
  limit?: number;
  onError?: (error: unknown) => void;
  onSuccess?: () => void;
}): AiFeatureRecoveryWorker {
  const intervalMs = input.intervalMs ?? 15_000;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error("AI Feature recovery interval must be positive.");

  let stopped = false;
  let inFlight: Promise<void> | null = null;
  const tick = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = recoverAiFeatureRuns({ definitions: input.definitions, limit: input.limit })
      .then(() => { input.onSuccess?.(); })
      .catch((error: unknown) => input.onError?.(error))
      .finally(() => { inFlight = null; });
    return inFlight;
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();

  return {
    tick,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}
