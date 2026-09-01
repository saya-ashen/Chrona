import { describe, expect, it } from "vitest";
import type { EffectivePlanGraph } from "./_leaf";
import { projectPublicEffectivePlanGraph } from "./public-effective-plan";

function graph(overrides: Partial<EffectivePlanGraph> = {}): EffectivePlanGraph {
  return {
    graphId: "graph-1",
    basePlanId: "plan-1",
    resolvedAt: "2026-08-01T00:00:00.000Z",
    resolvedVersion: 1,
    nodes: [],
    edges: [],
    entryNodeIds: [],
    terminalNodeIds: [],
    readyNodeIds: [],
    blockedNodeIds: [],
    waitingNodeIds: [],
    waitingForUserNodeIds: [],
    waitingForApprovalNodeIds: [],
    degradedNodeIds: [],
    skippedNodeIds: [],
    cancelledNodeIds: [],
    completedNodeIds: [],
    runningNodeIds: [],
    invalidatedNodeIds: [],
    failedNodeIds: [],
    pendingNodeIds: [],
    ...overrides,
  };
}

describe("projectPublicEffectivePlanGraph", () => {
  it("removes nested internal identities and preserves safe display fields", () => {
    const projected = projectPublicEffectivePlanGraph(graph({
      nodes: [
        {
          id: "node-1",
          nodeId: "node-1",
          activeLayerId: "layer-secret",
          semanticKey: "node.one",
          definition: { id: "def-secret" } as never,
          invalidated: true,
          invalidationReason: "attemptId-invalidation-secret",
          localId: "local-1",
          type: "task",
          title: "Write report",
          config: {},
          dependencies: [],
          dependents: [],
          status: "waiting",
          attempts: 2,
          lastError: "raw provider stack with session-secret",
          result: {
            outputSummary: "Safe summary",
            evidence: {
              sessionId: "session-secret",
              runId: "run-secret",
              provider: "provider-secret",
              runtimeName: "runtime-secret",
              runtimeRunRef: "runtime-run-secret",
            },
            artifactRefs: [{ id: "artifact-ref-secret", planRunId: "plan-run-secret", nodeId: "node-1", artifactType: "file", artifactId: "artifact-secret" }],
            deliverables: [{
              deliverableKey: "report",
              title: "Report",
              kind: "document",
              artifactRef: "AFsecret",
              status: "current",
              sourceNodeRef: "node-secret-ref",
              summary: "Safe deliverable summary",
              presentation: { primary: "document", allowDownload: true },
              placement: "primary",
            }],
            resultEvidence: [{ key: "ev", summary: "Safe evidence", artifactRef: "AFsecret", sourceNodeRef: "node-secret-ref" }],
            checkpointResponse: { secret: "checkpoint-secret" },
            error: "raw execution error secret",
            errorDetails: { secret: "error-details-secret" },
            actionForm: { instructions: "Confirm safe form", inputFields: [{ name: "notes", label: "Notes" }] },
            selectedBranch: { label: "Continue", nextNodeId: "node-2", source: "user", resolvedNextNodeId: "resolved-secret" },
          },
          metadata: { secret: "metadata-secret" },
          dependenciesSatisfied: true,
          ready: false,
          reachable: true,
        },
      ],
    }));

    const json = JSON.stringify(projected);
    for (const forbidden of [
      "session-secret",
      "run-secret",
      "provider-secret",
      "runtime-secret",
      "runtime-run-secret",
      "plan-run-secret",
      "generated://",
      "checkpoint-secret",
      "error-details-secret",
      "raw execution error secret",
      "metadata-secret",
      "attemptId-invalidation-secret",
      "layer-secret",
      "AFsecret",
      "node-secret-ref",
      "resolved-secret",
    ]) {
      expect(json).not.toContain(forbidden);
    }
    expect(json).toContain("Safe summary");
    expect(json).toContain("Safe deliverable summary");
    expect(json).toContain("Safe evidence");
    expect(json).toContain("Confirm safe form");
    expect(json).toContain("Continue");
    expect(json).toContain("Node execution failed.");
  });

  it("exposes only allowlisted manual form diagnostics", () => {
    const projected = projectPublicEffectivePlanGraph(graph({
      nodes: [{
        id: "node-1",
        nodeId: "node-1",
        activeLayerId: "layer-1",
        semanticKey: "manual.one",
        definition: { title: "Manual", objective: "Manual", semantics: { type: "task" } },
        invalidated: false,
        localId: "manual",
        type: "task",
        title: "Manual",
        config: {},
        dependencies: [],
        dependents: [],
        status: "failed",
        attempts: 1,
        result: {
          error: "raw provider failure",
          errorDetails: {
            code: "MANUAL_FORM_REVIEW_RESULT_INVALID",
            traceId: "feature-run-1",
            rawRequest: "never expose",
          },
        },
        metadata: {},
        dependenciesSatisfied: true,
        ready: false,
        reachable: true,
      }],
    }));

    expect(projected.nodes[0]?.result?.error).toEqual({
      present: true,
      message: "Node execution failed.",
      code: "MANUAL_FORM_REVIEW_RESULT_INVALID",
      traceId: "feature-run-1",
    });
    expect(JSON.stringify(projected)).not.toContain("never expose");
    expect(JSON.stringify(projected)).not.toContain("raw provider failure");
  });
});
