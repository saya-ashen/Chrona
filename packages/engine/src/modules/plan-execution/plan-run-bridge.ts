import { randomUUID } from "node:crypto";
import type {
  PlanRun,
  CompiledPlan,
  RuntimeCommand,
  PlanOverlayLayer,
  RuntimeLayer,
  ResultLayer,
  NodeRuntimeStatus,
} from "@chrona/contracts/ai";
import { createPlanRun, applyRuntimeCommand } from "@chrona/domain";

/**
 * Creates a PlanRun from a CompiledPlan and initial layers.
 * Entry nodes in the initial RuntimeLayer will already be marked "ready".
 */
export function createPlanRunFromCompiledPlan(
  compiled: CompiledPlan,
  initialLayers: PlanOverlayLayer[],
): PlanRun {
  const run = createPlanRun(compiled);

  for (const layer of initialLayers) {
    if (layer.type === "runtime" && layer.active) {
      for (const [nodeId, state] of Object.entries(layer.nodeStates)) {
        if (run.nodeStates[nodeId]) {
          run.nodeStates[nodeId].status = state.status as NodeRuntimeStatus;
        }
      }
    }
    if (layer.type === "result" && layer.active) {
      for (const [nodeId, result] of Object.entries(layer.nodeResults)) {
        if (result.artifactRefs && run.nodeStates[nodeId]) {
          for (const ref of result.artifactRefs) {
            if (!run.artifactRefs.some((r) => r.artifactType === ref.artifactType && r.nodeId === nodeId)) {
              run.artifactRefs.push({
                id: randomUUID(),
                planRunId: run.id,
                nodeId,
                artifactType: ref.artifactType,
                artifactId: ref.artifactId,
              });
            }
          }
        }
        if (result.checkpointResponse && run.nodeStates[nodeId]) {
          run.checkpointResponses.push({
            id: randomUUID(),
            planRunId: run.id,
            nodeId,
            response: result.checkpointResponse,
            submittedAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  return run;
}

/**
 * Applies a RuntimeCommand and produces the resulting RuntimeLayer delta.
 * DOES NOT mutate the PlanRun — returns a new layer to append.
 */
export function applyCommandAndProduceLayer(
  run: PlanRun,
  compiled: CompiledPlan,
  command: RuntimeCommand,
  layerVersion: number,
): { ok: boolean; run?: PlanRun; layer?: RuntimeLayer; error?: string } {
  const result = applyRuntimeCommand(run, compiled, command);

  if (!result.ok || !result.run) {
    return result;
  }

  const nodeStates: Record<string, { status: NodeRuntimeStatus; attempts?: number; lastError?: string }> = {};

  for (const [nodeId, state] of Object.entries(result.run.nodeStates)) {
    const prev = run.nodeStates[nodeId];
    if (!prev || prev.status !== state.status) {
      nodeStates[nodeId] = {
        status: state.status,
        attempts: state.attempts,
        lastError: state.lastError,
      };
    }
  }

  if (Object.keys(nodeStates).length === 0) {
    return { ok: true, run: result.run };
  }

  const layer: RuntimeLayer = {
    type: "runtime",
    layerId: `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    version: layerVersion,
    active: true,
    planId: compiled.editablePlanId,
    timestamp: new Date().toISOString(),
    nodeStates,
  };

  return { ok: true, run: result.run, layer };
}

/**
 * Builds a ResultLayer from a node execution's output.
 */
export function buildResultLayer(
  nodeId: string,
  planId: string,
  result: {
    outputSummary?: string;
    artifactRefs?: Array<{ artifactType: string; artifactId: string }>;
    checkpointResponse?: Record<string, unknown>;
  },
  layerVersion: number,
): ResultLayer {
  return {
    type: "result",
    layerId: `result_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    version: layerVersion,
    active: true,
    planId,
    timestamp: new Date().toISOString(),
    nodeResults: {
      [nodeId]: {
        outputSummary: result.outputSummary ?? undefined,
        artifactRefs: (result.artifactRefs ?? []).map((ref) => ({
          id: randomUUID(),
          planRunId: "",
          nodeId,
          artifactType: ref.artifactType,
          artifactId: ref.artifactId,
        })),
        checkpointResponse: result.checkpointResponse ?? null,
      },
    },
  };
}
