import type {
  NodeResult,
  ResultContribution,
  ResultEvidence,
  ResultManifest,
} from "@chrona/contracts/ai";

function mergeContributions(
  results: NodeResult[],
  field: "findings" | "decisions" | "caveats" | "nextActions",
  sourceNodeRef: (nodeId: string) => string,
): ResultContribution[] {
  const current = new Map<string, ResultContribution>();
  for (const result of results) {
    if (result.status !== "current" || !result.nodeId) continue;
    for (const item of result[field] ?? []) {
      current.set(item.key, {
        ...item,
        sourceNodeRef: item.sourceNodeRef ?? sourceNodeRef(result.nodeId),
      });
    }
  }
  return [...current.values()];
}

function mergeEvidence(
  results: NodeResult[],
  sourceNodeRef: (nodeId: string) => string,
): ResultEvidence[] {
  const current = new Map<string, ResultEvidence>();
  for (const result of results) {
    if (result.status !== "current" || !result.nodeId) continue;
    for (const item of result.resultEvidence ?? []) {
      current.set(item.key, {
        ...item,
        sourceNodeRef: item.sourceNodeRef || sourceNodeRef(result.nodeId),
      });
    }
  }
  return [...current.values()];
}

export function createEmptyResultManifest(): ResultManifest {
  const base: ResultManifest = {
    schemaVersion: 1,
    sourceRevision: 0,
    outcome: {
      title: "Result pending",
      summary: "No node result has been submitted.",
    },
    readiness: {
      status: "partial",
      summary: "Execution has not produced a finalized result.",
    },
    deliverables: [],
    findings: [],
    decisions: [],
    caveats: [],
    nextActions: [],
    evidence: [],
  };
  return base;
}

export function aggregateResultManifest(input: {
  results: NodeResult[];
  previous: ResultManifest;
  sourceNodeRef: (nodeId: string) => string;
}): ResultManifest {
  const submitted = input.results
    .filter((result) => result.status === "current")
    .flatMap((result) => result.deliverables ?? []);
  const currentByKey = new Map(
    submitted.map((deliverable) => [deliverable.deliverableKey, deliverable]),
  );
  const superseded = input.previous.deliverables
    .filter((prior) => {
      const current = currentByKey.get(prior.deliverableKey);
      return (
        prior.status === "superseded" ||
        (current !== undefined && current.artifactRef !== prior.artifactRef)
      );
    })
    .map((prior) => ({ ...prior, status: "superseded" as const }));
  const deliverables = [
    ...superseded,
    ...[...currentByKey.values()].map((deliverable) => {
      const prior = input.previous.deliverables.find(
        (candidate) =>
          candidate.deliverableKey === deliverable.deliverableKey &&
          candidate.artifactRef !== deliverable.artifactRef &&
          candidate.status === "current",
      );
      return {
        ...deliverable,
        status: "current" as const,
        ...(prior ? { supersedes: prior.artifactRef } : {}),
      };
    }),
  ].filter(
    (deliverable, index, list) =>
      list.findIndex(
        (candidate) => candidate.artifactRef === deliverable.artifactRef,
      ) === index,
  );
  const findings = mergeContributions(
    input.results,
    "findings",
    input.sourceNodeRef,
  );
  const decisions = mergeContributions(
    input.results,
    "decisions",
    input.sourceNodeRef,
  );
  const caveats = mergeContributions(
    input.results,
    "caveats",
    input.sourceNodeRef,
  );
  const nextActions = mergeContributions(
    input.results,
    "nextActions",
    input.sourceNodeRef,
  );
  const evidence = mergeEvidence(input.results, input.sourceNodeRef);
  const summaries = input.results
    .filter(
      (result) => result.status === "current" && result.outputSummary?.trim(),
    )
    .map((result) => result.outputSummary!.trim());
  const candidate: ResultManifest = {
    schemaVersion: 1,
    sourceRevision: input.previous.sourceRevision,
    outcome: {
      title: summaries.at(-1) ?? "Execution result",
      summary:
        summaries.join("\n\n") ||
        "Execution completed without a textual summary.",
    },
    readiness: {
      status: caveats.length > 0 ? "ready_with_caveats" : "ready",
      summary:
        caveats.length > 0
          ? "Result is ready with documented caveats."
          : "Result is ready for final organization.",
    },
    deliverables,
    findings,
    decisions,
    caveats,
    nextActions,
    evidence,
  };
  if (JSON.stringify(candidate) === JSON.stringify(input.previous)) {
    return input.previous;
  }
  return {
    ...candidate,
    sourceRevision: input.previous.sourceRevision + 1,
  };
}
