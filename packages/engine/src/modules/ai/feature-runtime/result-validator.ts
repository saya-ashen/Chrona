/* eslint-disable complexity -- Result validation explicitly covers every public result and evidence variant. */
import type {
  AiJsonObject,
  AiObservationEnvelope,
  AiRunResult,
  EvidenceReference,
  ProducedArtifactReference,
  ProposedAction,
} from "@chrona/contracts/ai-feature-runtime";
import { createAiRunResultSchema } from "@chrona/contracts/ai-feature-runtime";
import type { z } from "zod";
import type { AiFeatureDefinition } from "./define-feature";
import { findProposedActionBinding } from "./action-registry";
import { isManifestObservation } from "./observation-registry";
import { sameAiContractRef } from "./identifiers";
import { stableJsonHash } from "./stable-json";

export type ResultValidationFailure = {
  code: "result_invalid" | "output_invalid" | "evidence_invalid" | "action_not_allowed" | "action_input_invalid" | "artifact_invalid";
  message: string;
};

export type ResultValidationSuccess<Output extends AiJsonObject> = {
  ok: true;
  result: AiRunResult & ({ status: "completed"; output: Output } | { status: "needs_input" } | { status: "cannot_complete" });
  proposedActions: readonly ProposedAction[];
};

export type ResultValidationResult<Output extends AiJsonObject> =
  | ResultValidationSuccess<Output>
  | { ok: false; error: ResultValidationFailure };

function pointerValue(value: unknown, pointer: string): { found: boolean; value?: unknown } {
  if (pointer === "") return { found: true, value };
  let current: unknown = value;
  for (const encoded of pointer.slice(1).split("/")) {
    const key = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!current || typeof current !== "object" || !(key in current)) return { found: false };
    current = (current as Record<string, unknown>)[key];
  }
  return { found: true, value: current };
}

function evidenceTarget(data: unknown, path: string | undefined) {
  if (path === undefined) return { found: true, value: data };
  const direct = pointerValue(data, path);
  if (direct.found || (path !== "/data" && !path.startsWith("/data/"))) return direct;
  // Providers occasionally address the full observation envelope even though
  // the contract defines paths relative to observation.data. `/data/...` is
  // an unambiguous alias for the same frozen value and cannot escape it.
  return pointerValue(data, path === "/data" ? "" : path.slice("/data".length));
}

function evidenceIsFrozen(evidence: readonly EvidenceReference[], observations: readonly AiObservationEnvelope[]): boolean {
  const byId = new Map(observations.map((observation) => [observation.observationId, observation]));
  return evidence.every((reference) => {
    const observation = byId.get(reference.observationId);
    if (!observation) return false;
    const target = evidenceTarget(observation.data, reference.path);
    return target.found && (!reference.quoteHash || stableJsonHash(target.value) === reference.quoteHash);
  });
}

function resultSchema<Output extends AiJsonObject>(definition: AiFeatureDefinition<AiJsonObject, Output>): z.ZodType {
  return createAiRunResultSchema(definition.outputSchema, definition.outputSchema);
}

async function artifactError<Output extends AiJsonObject>(input: {
  definition: AiFeatureDefinition<AiJsonObject, Output>;
  artifacts: readonly ProducedArtifactReference[];
  workspaceId?: string;
  subject?: { type: string; id: string; revision?: string };
  observations: readonly AiObservationEnvelope[];
}): Promise<ResultValidationFailure | null> {
  const resolvers = input.definition.artifacts ?? [];
  for (const artifact of input.artifacts) {
    const binding = input.definition.manifest.artifacts.find(({ artifactType }) => sameAiContractRef(artifactType, artifact.artifactType));
    const resolver = resolvers.find(({ binding: candidate }) => sameAiContractRef(candidate.artifactType, artifact.artifactType));
    if (!binding || !resolver || (binding.requireContentHash && !artifact.contentHash)) return { code: "artifact_invalid", message: "Result returned an artifact outside the feature manifest." };
    if (!input.workspaceId || !input.subject) return { code: "artifact_invalid", message: "Artifact validation requires run ownership context." };
    const resolved = await resolver.resolve({ workspaceId: input.workspaceId, subject: input.subject, artifact, observations: input.observations });
    if (!resolved || resolved.artifactRef !== artifact.artifactRef || !sameAiContractRef(resolved.artifactType, artifact.artifactType)
      || resolved.title !== artifact.title || resolved.mediaType !== artifact.mediaType || resolved.contentHash !== artifact.contentHash) {
      return { code: "artifact_invalid", message: "Result artifact did not match its resolved frozen allowlist entry." };
    }
  }
  return null;
}

/** Validates a provider terminal envelope against only frozen run state. */
export async function validateAiFeatureResult<Output extends AiJsonObject>(input: {
  definition: AiFeatureDefinition<AiJsonObject, Output>;
  candidate: unknown;
  observations: readonly AiObservationEnvelope[];
  workspaceId?: string;
  subject?: { type: string; id: string; revision?: string };
}): Promise<ResultValidationResult<Output>> {
  const parsed = resultSchema(input.definition).safeParse(input.candidate);
  if (!parsed.success) return { ok: false, error: { code: "result_invalid", message: "Provider returned an invalid terminal result." } };
  const result = parsed.data as AiRunResult;
  if (!input.definition.manifest.supportedTerminalStatuses.includes(result.status)) return { ok: false, error: { code: "result_invalid", message: `Feature does not support terminal status: ${result.status}` } };
  if (result.status === "cannot_complete" && !result.missingObservations.every((reference) => isManifestObservation(input.definition.manifest.observations, reference))) return { ok: false, error: { code: "result_invalid", message: "Cannot-complete results may name only manifest observations." } };
  if (result.status !== "completed") return { ok: true, result, proposedActions: [] };
  if (!evidenceIsFrozen(result.evidence, input.observations)) return { ok: false, error: { code: "evidence_invalid", message: "Result evidence must resolve within a frozen observation." } };
  const output = input.definition.outputSchema.safeParse(result.output);
  if (!output.success) return { ok: false, error: { code: "output_invalid", message: "Result output does not satisfy the feature contract." } };

  const proposals: ProposedAction[] = [];
  const proposalIds = new Set<string>();
  for (const proposal of result.proposedActions) {
    if (proposalIds.has(proposal.proposalId)) return { ok: false, error: { code: "action_input_invalid", message: "Proposed action IDs must be unique." } };
    proposalIds.add(proposal.proposalId);
    const binding = findProposedActionBinding(input.definition.manifest.actions, proposal.action);
    const action = input.definition.actions.find(({ binding: candidate }) => sameAiContractRef(candidate.action, proposal.action));
    if (!binding || !action) return { ok: false, error: { code: "action_not_allowed", message: "Result proposed an action not allowed by this feature." } };
    if (action.inputSchema && !action.inputSchema.safeParse(proposal.input).success) return { ok: false, error: { code: "action_input_invalid", message: "Proposed action input does not satisfy its contract." } };
    if (!evidenceIsFrozen(proposal.evidence, input.observations)) return { ok: false, error: { code: "evidence_invalid", message: "Proposed action evidence must resolve within a frozen observation." } };
    proposals.push(proposal);
  }
  const artifactFailure = await artifactError({ definition: input.definition, artifacts: result.artifacts, workspaceId: input.workspaceId, subject: input.subject, observations: input.observations });
  if (artifactFailure) return { ok: false, error: artifactFailure };
  return { ok: true, result: { ...result, output: output.data }, proposedActions: proposals };
}
