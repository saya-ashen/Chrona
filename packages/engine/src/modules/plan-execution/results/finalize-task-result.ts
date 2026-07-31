import { db } from "@/lib/db";
import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import type {
  NodeDeliverableDeclaration,
  NodeResult,
  PlanOutputState,
  ResultManifest,
} from "@chrona/contracts/ai";
import { agentControlActionBodySchema } from "@chrona/contracts/api";
import { buildResultFinalizationFeatureSpec } from "@chrona/contracts";
import { validateChronaSpec, type UiDocument } from "@chrona/ui-protocol";
import { getAiClientForTask, runProviderRequest } from "../../ai";
import { submitNodeResultActionFromControl } from "../../agent-tools/node-result-action";
import { getPlanRun, savePlanRunGuarded } from "../persistence/plan-run-store";
import { getAcceptedCompiledPlanForTask } from "../persistence/execution-scope";
import { registerNodeDeliverables } from "../use-cases/register-generated-plan-output-artifacts";
import { aggregateResultManifest } from "./result-manifest";
import { buildSemanticRefHistory } from "../runtime/node-runtime-refs";

const HOST_ONLY_KEYS: Readonly<Record<string, true>> = {
  downloadHref: true,
  accessTaskId: true,
  taskId: true,
  runId: true,
  runToken: true,
  providerRequest: true,
  provider: true,
  sourceNodeId: true,
  xChronaSourceNodeId: true,
};
const ARTIFACT_REF_PATTERN = /^AF[A-F0-9]{12}$/;
const BACKEND_ID_PATTERN = /^c[a-z0-9]{20,}$/;

function parsedProviderPayload(payload: unknown): unknown {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("parsed" in payload)
  ) {
    throw new Error("Result finalization provider did not return a parsed payload");
  }
  return payload.parsed;
}

function stripHostOnly(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripHostOnly);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (!(key in HOST_ONLY_KEYS)) result[key] = stripHostOnly(child);
  }
  return result;
}

function forbiddenValue(value: unknown): string | null {
  if (typeof value === "string") {
    if (value.startsWith("generated://")) return "generated file URI";
    if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value))
      return "absolute file path";
    if (BACKEND_ID_PATTERN.test(value)) return "backend identifier";
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const forbidden = forbiddenValue(item);
      if (forbidden) return forbidden;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const child of Object.values(value as Record<string, unknown>)) {
    const forbidden = forbiddenValue(child);
    if (forbidden) return forbidden;
  }
  return null;
}

function artifactRefs(value: unknown): string[] {
  const refs: string[] = [];
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) return void candidate.forEach(visit);
    if (!candidate || typeof candidate !== "object") return;
    for (const [key, child] of Object.entries(
      candidate as Record<string, unknown>,
    )) {
      if (
        (key === "path" || key === "uri" || key === "artifactRef") &&
        typeof child === "string" &&
        child.startsWith("AF")
      )
        refs.push(child);
      visit(child);
    }
  };
  visit(value);
  return refs;
}

const MAX_FINALIZED_RESULT_ELEMENTS = 48;
const MAX_FINALIZED_RESULT_DEPTH = 5;

function manifestContentKeys(manifest: ResultManifest) {
  return new Set([
    ...manifest.deliverables
      .filter((item) => item.status === "current")
      .map((item) => item.deliverableKey),
    ...manifest.findings.map((item) => item.key),
    ...manifest.decisions.map((item) => item.key),
    ...manifest.caveats.map((item) => item.key),
    ...manifest.nextActions.map((item) => item.key),
    ...manifest.evidence.map((item) => item.key),
  ]);
}

function validateSemanticComposition(
  manifest: ResultManifest,
  spec: UiDocument,
) {
  const entries = Object.entries(spec.elements);
  if (entries.length > MAX_FINALIZED_RESULT_ELEMENTS) {
    throw new Error(
      `Finalized result exceeds the ${MAX_FINALIZED_RESULT_ELEMENTS}-element complexity limit`,
    );
  }
  const allowedSourceKeys = manifestContentKeys(manifest);
  const referencedSourceKeys = new Set<string>();
  for (const [elementKey, element] of entries) {
    const props = element.props;
    const sourceKeys = props.sourceKeys;
    if (sourceKeys === undefined) continue;
    if (!Array.isArray(sourceKeys) || sourceKeys.length === 0) {
      throw new Error(
        `Finalized result element ${elementKey} has invalid sourceKeys`,
      );
    }
    for (const sourceKey of sourceKeys) {
      if (typeof sourceKey !== "string" || !allowedSourceKeys.has(sourceKey)) {
        throw new Error(
          `Finalized result element ${elementKey} references unknown source key ${String(sourceKey)}`,
        );
      }
      referencedSourceKeys.add(sourceKey);
    }
  }

  const visit = (elementKey: string, depth: number) => {
    if (depth > MAX_FINALIZED_RESULT_DEPTH) {
      throw new Error(
        `Finalized result exceeds the ${MAX_FINALIZED_RESULT_DEPTH}-level nesting limit`,
      );
    }
    for (const child of spec.elements[elementKey].children ?? [])
      visit(child, depth + 1);
  };
  visit(spec.root, 1);

  const primaryKeys = [
    ...manifest.deliverables
      .filter(
        (item) => item.status === "current" && item.placement === "primary",
      )
      .map((item) => item.deliverableKey),
    ...manifest.findings
      .filter((item) => item.importance === "primary")
      .map((item) => item.key),
    ...manifest.decisions
      .filter((item) => item.importance === "primary")
      .map((item) => item.key),
    ...manifest.caveats
      .filter((item) => item.importance === "primary")
      .map((item) => item.key),
    ...manifest.nextActions
      .filter((item) => item.importance === "primary")
      .map((item) => item.key),
  ];
  if (
    primaryKeys.length > 0 &&
    !primaryKeys.some((key) => referencedSourceKeys.has(key))
  ) {
    throw new Error(
      "Finalized result does not cover any primary manifest content",
    );
  }

  const deliverables = entries.filter(
    ([, element]) => element.type === "ResultDeliverable",
  );
  const primaryDeliverables = deliverables.filter(
    ([, element]) => element.props.role === "primary",
  );
  if (deliverables.length > 3 || primaryDeliverables.length > 1) {
    throw new Error("Finalized result exceeds the narrative deliverable limit");
  }
  const legacyInsights = entries.filter(
    ([, element]) => element.type === "ResultInsight",
  );
  if (legacyInsights.length > 2) {
    throw new Error("Finalized result repeats too many legacy insight blocks");
  }

  if (manifest.readiness.status !== "ready") {
    const readinessVisible = entries.some(
      ([, element]) =>
        element.type === "ResultReadiness" ||
        element.type === "ResultCaveats" ||
        element.type === "Alert",
    );
    if (!readinessVisible) {
      throw new Error("Finalized result omits non-ready result readiness");
    }
  }
}

function validateFinalizedResultSpec(input: {
  manifest: ResultManifest;
  payload: unknown;
}): UiDocument {
  const stripped = stripHostOnly(input.payload);
  const forbidden = forbiddenValue(stripped);
  if (forbidden) {
    throw new Error(`Finalized result contains a forbidden ${forbidden}`);
  }
  const allowed = new Set(
    input.manifest.deliverables.map((item) => item.artifactRef),
  );
  for (const ref of artifactRefs(stripped)) {
    if (!ARTIFACT_REF_PATTERN.test(ref) || !allowed.has(ref as never)) {
      throw new Error(`Finalized result references undeclared artifact ${ref}`);
    }
  }
  const validation = validateChronaSpec(stripped);
  if (!validation.ok) {
    throw new Error(
      `Finalized result is not a valid Chrona Spec: ${validation.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  validateSemanticComposition(
    input.manifest,
    validation.spec as unknown as UiDocument,
  );
  return validation.spec as unknown as UiDocument;
}

async function restoreRecordedTerminalResults(input: {
  taskId: string;
  accepted: NonNullable<
    Awaited<ReturnType<typeof getAcceptedCompiledPlanForTask>>
  >;
  persisted: NonNullable<Awaited<ReturnType<typeof getPlanRun>>>;
}) {
  if (!input.persisted.graph) return input.persisted;
  const actions = await db.taskPlanTerminalAction.findMany({
    where: {
      taskId: input.taskId,
      kind: "complete",
      nodeAttemptId: { not: null },
    },
    orderBy: { recordedAt: "asc" },
  });
  const semanticRefs = buildSemanticRefHistory(
    resolveEffectivePlanGraph({
      graph: input.persisted.graph,
      attempts: input.persisted.attempts,
      results: input.persisted.results,
    }),
  );
  if (actions.length === 0) return input.persisted;

  const byAttempt = new Map(
    actions.map((action) => [action.nodeAttemptId!, action]),
  );
  let changed = false;
  const results: NodeResult[] = [];
  for (const result of input.persisted.results) {
    const action = result.attemptId
      ? byAttempt.get(result.attemptId)
      : undefined;
    if (!action || result.status !== "current") {
      results.push(result);
      continue;
    }
    const parsed = submitNodeResultActionFromControl({
      body: agentControlActionBodySchema.parse({
        kind: action.kind,
        payload: action.payload,
      }),
      sessionId: action.taskSessionId ?? undefined,
    });
    if (parsed?.action !== "complete_manual_node") {
      results.push(result);
      continue;
    }
    const sourceNodeId = result.nodeId ?? action.nodeId ?? "unknown-node";
    const sourceNodeRef = semanticRefs.nodeRefs.find(
      (binding) =>
        binding.nodeId === sourceNodeId || binding.backendId === sourceNodeId,
    )?.ref;
    const deliverables = parsed.deliverables?.length
      ? await registerNodeDeliverables({
          workspaceId: input.accepted.workspaceId,
          taskId: input.taskId,
          runId: action.runId,
          sourceNodeId,
          sourceNodeRef,
          declarations: parsed.deliverables as NodeDeliverableDeclaration[],
        })
      : result.deliverables;
    const restored: NodeResult = {
      ...result,
      outputSummary: parsed.summary ?? result.outputSummary,
      deliverables,
      findings: parsed.findings,
      decisions: parsed.decisions,
      caveats: parsed.caveats,
      nextActions: parsed.nextActions,
      resultEvidence: parsed.evidenceItems?.map((item) => ({
        ...item,
        sourceNodeRef: sourceNodeRef ?? "",
      })),
    };
    if (JSON.stringify(restored) !== JSON.stringify(result)) changed = true;
    results.push(restored);
  }
  if (!changed) return input.persisted;

  const manifest = aggregateResultManifest({
    results,
    previous: input.persisted.planOutput.manifest,
    sourceNodeRef: (nodeId) =>
      semanticRefs.nodeRefs.find(
        (binding) => binding.nodeId === nodeId || binding.backendId === nodeId,
      )?.ref ?? nodeId,
  });
  const planOutput: PlanOutputState = {
    ...input.persisted.planOutput,
    manifest,
    finalizedResult: null,
    finalization: {
      status: "Pending",
      sourceRevision: manifest.sourceRevision,
    },
    revision: input.persisted.planOutput.revision + 1,
    updatedAt: new Date().toISOString(),
    updatedByNodeId: null,
  };
  const saved = await savePlanRunGuarded({
    workspaceId: input.accepted.workspaceId,
    taskId: input.taskId,
    planId: input.accepted.compiledPlan.editablePlanId,
    workBlockId: input.accepted.workBlockId,
    expectedEpoch: input.persisted.executionEpoch,
    run: input.persisted.planRun,
    compiledPlan: input.accepted.compiledPlan,
    graph: input.persisted.graph,
    attempts: input.persisted.attempts,
    results,
    executionContextSnapshots: input.persisted.executionContextSnapshots,
    planOutput,
  });
  if (!saved.committed)
    throw new Error("Recorded terminal results changed concurrently");
  return (await getPlanRun(
    input.taskId,
    input.accepted.compiledPlan.editablePlanId,
    input.accepted.workBlockId,
  ))!;
}
export const __resultFinalizationTestHooks = {
  parsedProviderPayload,
  validateFinalizedSpec: validateFinalizedResultSpec,
  restoreRecordedTerminalResults,
  validateSemanticComposition,
};

export async function finalizeTaskResult(input: {
  taskId: string;
  workBlockId?: string | null;
  force?: boolean;
}): Promise<PlanOutputState> {
  const accepted = await getAcceptedCompiledPlanForTask(input.taskId, {
    workBlockId: input.workBlockId,
  });
  if (!accepted)
    throw new Error("No accepted plan is available for result finalization");
  const initial = await getPlanRun(
    input.taskId,
    accepted.compiledPlan.editablePlanId,
    accepted.workBlockId,
  );
  if (!initial?.graph)
    throw new Error("No persisted execution graph is available");
  const persisted = await restoreRecordedTerminalResults({
    taskId: input.taskId,
    accepted,
    persisted: initial,
  });
  const sourceRevision = persisted.planOutput.manifest.sourceRevision;
  if (
    persisted.planOutput.finalization.status === "Ready" &&
    persisted.planOutput.finalizedResult?.sourceRevision === sourceRevision &&
    !input.force
  )
    return persisted.planOutput;
  const attempt =
    "attempt" in persisted.planOutput.finalization
      ? persisted.planOutput.finalization.attempt + 1
      : 1;
  const running: PlanOutputState = {
    ...persisted.planOutput,
    finalization: {
      status: "Running",
      sourceRevision,
      attempt,
      startedAt: new Date().toISOString(),
    },
  };
  const runningSave = await savePlanRunGuarded({
    workspaceId: accepted.workspaceId,
    taskId: input.taskId,
    planId: accepted.compiledPlan.editablePlanId,
    workBlockId: accepted.workBlockId,
    expectedEpoch: persisted.executionEpoch,
    run: persisted.planRun,
    compiledPlan: accepted.compiledPlan,
    graph: persisted.graph!,
    attempts: persisted.attempts,
    results: persisted.results,
    executionContextSnapshots: persisted.executionContextSnapshots,
    planOutput: running,
  });
  if (!runningSave.committed)
    throw new Error("Result finalization changed concurrently");

  try {
    const client = await getAiClientForTask({
      taskId: input.taskId,
      purpose: "task.result_finalization",
    });
    if (!client?.providerClient) {
      throw new Error("No AI client is configured for result finalization");
    }
    const featureSpec = buildResultFinalizationFeatureSpec({
      manifest: running.manifest,
    });
    const response = await runProviderRequest(client.providerClient, {
      sessionId: `result-finalization:${input.taskId}:${sourceRevision}:${attempt}`,
      sessionKey: `result-finalization:${input.taskId}:${sourceRevision}:${attempt}`,
      instructions: featureSpec.instructions,
      input: { manifest: running.manifest },
      structuredOutputSchema: featureSpec.structuredOutputSchema,
      toolPolicy: "read_only",
      stream: true,
    });
    if (response.error || response.status !== "completed") {
      throw new Error(
        response.error ??
          `Result finalization provider ended with status ${response.status}`,
      );
    }
    const spec = validateFinalizedResultSpec({
      manifest: running.manifest,
      payload: parsedProviderPayload(response.structuredPayload),
    });
    const latest = await getPlanRun(
      input.taskId,
      accepted.compiledPlan.editablePlanId,
      accepted.workBlockId,
    );
    if (
      !latest?.graph ||
      latest.planOutput.manifest.sourceRevision !== sourceRevision
    ) {
      throw new Error("Result manifest changed during finalization");
    }
    const finalizedAt = new Date().toISOString();
    const ready: PlanOutputState = {
      ...latest.planOutput,
      finalizedResult: {
        sourceRevision,
        manifest: latest.planOutput.manifest,
        spec,
        finalizedAt,
      },
      finalization: { status: "Ready", sourceRevision, attempt, finalizedAt },
    };
    const saved = await savePlanRunGuarded({
      workspaceId: accepted.workspaceId,
      taskId: input.taskId,
      planId: accepted.compiledPlan.editablePlanId,
      workBlockId: accepted.workBlockId,
      expectedEpoch: latest.executionEpoch,
      run: latest.planRun,
      compiledPlan: accepted.compiledPlan,
      graph: latest.graph,
      attempts: latest.attempts,
      results: latest.results,
      executionContextSnapshots: latest.executionContextSnapshots,
      planOutput: ready,
    });
    if (!saved.committed)
      throw new Error("Result finalization changed concurrently");
    return ready;
  } catch (error) {
    const latest = await getPlanRun(
      input.taskId,
      accepted.compiledPlan.editablePlanId,
      accepted.workBlockId,
    );
    if (
      latest?.graph &&
      latest.planOutput.manifest.sourceRevision === sourceRevision
    ) {
      const failedAt = new Date().toISOString();
      await savePlanRunGuarded({
        workspaceId: accepted.workspaceId,
        taskId: input.taskId,
        planId: accepted.compiledPlan.editablePlanId,
        workBlockId: accepted.workBlockId,
        expectedEpoch: latest.executionEpoch,
        run: latest.planRun,
        compiledPlan: accepted.compiledPlan,
        graph: latest.graph,
        attempts: latest.attempts,
        results: latest.results,
        executionContextSnapshots: latest.executionContextSnapshots,
        planOutput: latest.planOutput.finalizedResult
          ? {
              ...latest.planOutput,
              finalization: {
                status: "Ready",
                sourceRevision,
                attempt,
                finalizedAt: latest.planOutput.finalizedResult.finalizedAt,
              },
            }
          : {
              ...latest.planOutput,
              finalizedResult: null,
              finalization: {
                status: "Failed",
                sourceRevision,
                attempt,
                failedAt,
                errorCode: "RESULT_FINALIZATION_FAILED",
                errorMessage:
                  error instanceof Error ? error.message : String(error),
              },
            },
      });
    }
    throw error;
  }
}
