/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Registry guards runtime values crossing an untyped persistence boundary. */
import { aiObservationEnvelopeSchema } from "@chrona/contracts/ai-feature-runtime";
import type { AiContractRef, AiJsonObject, AiObservationEnvelope, ObservationBinding } from "@chrona/contracts/ai-feature-runtime";
import type { AiFeatureDefinition, AiFeatureObservationContext } from "./define-feature";
import { sameAiContractRef } from "./identifiers";
import { stableJsonHash } from "./stable-json";

export type ObservationBuildFailure = {
  code: "observation_invalid" | "observation_limit_exceeded";
  message: string;
};

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function matchesBinding(observation: AiObservationEnvelope, binding: ObservationBinding): boolean {
  return sameAiContractRef(observation.type, binding.observation);
}

function hasCanonicalIntegrity(observation: AiObservationEnvelope): boolean {
  return observation.canonicalizerId === "chrona.stable-json.v1"
    && observation.hashAlgorithm === "sha256"
    && observation.contentHash === stableJsonHash(observation.data);
}

/** Accepts only canonical observations produced by the declared invoke action. */
export function validateActionOutputObservation(input: {
  observation: unknown;
  bindings: readonly ObservationBinding[];
  action: AiContractRef;
}): AiObservationEnvelope | null {
  const parsed = aiObservationEnvelopeSchema.safeParse(input.observation);
  if (!parsed.success) return null;
  const binding = input.bindings.find((candidate) => matchesBinding(parsed.data, candidate));
  if (!binding || binding.delivery.kind === "seed") return null;
  const sourceAction = binding.delivery.kind === "action_result" ? binding.delivery.fromAction : binding.delivery.viaAction;
  if (!sameAiContractRef(sourceAction, input.action) || !hasCanonicalIntegrity(parsed.data)) return null;
  if (binding.maxBytes && byteLength(parsed.data.data) > binding.maxBytes) return null;
  return parsed.data;
}

/** Builds bounded seed observations only; no on-demand data is fetched implicitly. */
export async function buildSeedObservations(input: {
  definition: AiFeatureDefinition;
  context: AiFeatureObservationContext;
}): Promise<{ ok: true; observations: readonly AiObservationEnvelope[] } | { ok: false; error: ObservationBuildFailure }> {
  const observations: AiObservationEnvelope[] = [];
  const ids = new Set<string>();
  for (const binding of input.definition.manifest.observations) {
    if (binding.delivery.kind !== "seed") continue;
    const builder = input.definition.observations.find(({ binding: candidate }) => sameAiContractRef(candidate.observation, binding.observation));
    if (!builder) {
      if (binding.required) return { ok: false, error: { code: "observation_invalid", message: "A required seed observation has no builder." } };
      continue;
    }
    let observation: AiObservationEnvelope;
    try {
      observation = aiObservationEnvelopeSchema.parse(await builder.build(input.context));
    } catch {
      return { ok: false, error: { code: "observation_invalid", message: "A seed observation could not be built." } };
    }
    if (!matchesBinding(observation, binding) || !hasCanonicalIntegrity(observation) || ids.has(observation.observationId)) return { ok: false, error: { code: "observation_invalid", message: "A seed observation does not match the feature manifest or canonical integrity contract." } };
    if (binding.maxBytes && byteLength(observation.data) > binding.maxBytes) return { ok: false, error: { code: "observation_limit_exceeded", message: "A seed observation exceeds its byte limit." } };
    ids.add(observation.observationId);
    observations.push(observation);
  }
  return { ok: true, observations };
}

export function isManifestObservation(bindings: readonly ObservationBinding[], reference: { id: string; version: number }): boolean {
  return bindings.some(({ observation }) => sameAiContractRef(observation, reference));
}

export type ObservationInput = AiJsonObject;
