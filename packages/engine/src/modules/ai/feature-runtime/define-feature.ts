/* eslint-disable complexity -- Feature definition validation intentionally enumerates all contract invariants. */
import type { z } from "zod";
import type {
  ActionBinding,
  AiContractRef,
  AiFeatureManifest,
  AiFeatureSubject,
  AiJsonObject,
  AiObjective,
  AiObservationEnvelope,
  AiRunResult,
  ArtifactBinding,
  CompletionValidation,
  ObservationBinding,
  ProducedArtifactReference,
  ProposedAction,
} from "@chrona/contracts/ai-feature-runtime";
import { aiFeatureManifestSchema } from "@chrona/contracts/ai-feature-runtime";
import { freezeCanonical } from "./stable-json";

export type AiFeatureObservationDefinition<Input extends AiJsonObject = AiJsonObject> = {
  binding: Pick<ObservationBinding, "observation">;
  build(context: AiFeatureObservationContext<Input>): Promise<AiObservationEnvelope> | AiObservationEnvelope;
};

export type AiFeatureObservationContext<Input extends AiJsonObject = AiJsonObject> = {
  workspaceId: string;
  subject: AiFeatureSubject;
  input: Input;
};

export type AiFeatureActionDefinition<FeatureInput extends AiJsonObject = AiJsonObject> = {
  binding: ActionBinding;
  /** Provider-visible explanation for an engine-managed invoke action. */
  description?: string;
  inputSchema?: z.ZodType<AiJsonObject>;
  execute?(context: AiFeatureActionContext<FeatureInput>): Promise<AiObservationEnvelope> | AiObservationEnvelope;
};

export type AiFeatureActionContext<FeatureInput extends AiJsonObject = AiJsonObject> = {
  workspaceId: string;
  subject: AiFeatureSubject;
  /** Immutable, validated feature-run input. */
  featureInput: FeatureInput;
  /** Validated provider input for this one invoke action. */
  actionInput: AiJsonObject;
  callId: string;
  executionKey: string;
  observations: readonly AiObservationEnvelope[];
};

export type AiFeatureArtifactDefinition = {
  binding: ArtifactBinding;
  resolve(context: AiFeatureArtifactContext): Promise<ProducedArtifactReference | null> | ProducedArtifactReference | null;
};

export type AiFeatureArtifactContext = {
  workspaceId: string;
  subject: AiFeatureSubject;
  artifact: ProducedArtifactReference;
  observations: readonly AiObservationEnvelope[];
};

export type AiFeatureCompilationContext<Input extends AiJsonObject = AiJsonObject> = {
  workspaceId: string;
  subject: AiFeatureSubject;
  input: Input;
  objective: AiObjective;
  observations: readonly AiObservationEnvelope[];
};

export type AiFeatureCompletionContext<Output extends AiJsonObject, Input extends AiJsonObject = AiJsonObject> = {
  workspaceId: string;
  subject: AiFeatureSubject;
  input: Input;
  result: Extract<AiRunResult, { status: "completed" }> & { output: Output };
  observations: readonly AiObservationEnvelope[];
};

/**
 * Everything a custom committer needs to atomically compare-and-swap and
 * terminalize the durable run with its feature-owned projection.
 */
export type AiFeatureCommitContext<Output extends AiJsonObject, Input extends AiJsonObject = AiJsonObject> = {
  workspaceId: string;
  subject: AiFeatureSubject;
  input: Input;
  observations: readonly AiObservationEnvelope[];
  runId: string;
  expectedStateVersion: number;
  leaseOwner: string;
  leaseExpiresAt?: string;
  terminal: {
    result: AiRunResult & ({ status: "completed"; output: Output } | { status: "needs_input" } | { status: "cannot_complete" });
    completion?: CompletionValidation;
    proposedActions: readonly ProposedAction[];
    finishedAt: string;
  };
};

/** A committer may return its atomically persisted receipt; the durable run is still re-read as proof. */
export type AiFeatureCommitResult = { commitReference?: AiJsonObject } | void;

export type AiFeatureDefinition<
  Input extends AiJsonObject = AiJsonObject,
  Output extends AiJsonObject = AiJsonObject,
  PartialOutput extends AiJsonObject = Output,
> = {
  manifest: AiFeatureManifest;
  /** Chrona client-management capability used to resolve the provider adapter. */
  providerBindingFeature: string;
  inputSchema: z.ZodType<Input>;
  outputSchema: z.ZodType<Output>;
  /** Schema for recoverable partial output; defaults to the complete output contract. */
  partialOutputSchema?: z.ZodType<PartialOutput>;
  subjectSchema: z.ZodType<AiFeatureSubject>;
  resolveSubject(context: {
    workspaceId: string;
    subject: AiFeatureSubject;
    input: Input;
  }): Promise<AiFeatureSubject> | AiFeatureSubject;
  buildObjective(input: Input): AiObjective;
  buildInstructions(context: AiFeatureCompilationContext<Input>): string;
  observations: readonly AiFeatureObservationDefinition<Input>[];
  actions: readonly AiFeatureActionDefinition<Input>[];
  artifacts?: readonly AiFeatureArtifactDefinition[];
  commitResult?(context: AiFeatureCommitContext<Output, Input>): Promise<AiFeatureCommitResult> | AiFeatureCommitResult;
  validateCompletion(context: AiFeatureCompletionContext<Output, Input>): CompletionValidation;
};

export type DefinedAiFeature<
  Input extends AiJsonObject = AiJsonObject,
  Output extends AiJsonObject = AiJsonObject,
  PartialOutput extends AiJsonObject = Output,
> = AiFeatureDefinition<Input, Output, PartialOutput> & {
  readonly feature: AiContractRef;
  readonly partialOutputSchema: z.ZodType<PartialOutput>;
};

function sameReference(left: AiContractRef, right: AiContractRef): boolean {
  return left.id === right.id && left.version === right.version;
}

function referenceKey(reference: AiContractRef): string {
  return `${reference.id}:${reference.version}`;
}

function ensureUniqueReferences(kind: string, references: readonly AiContractRef[]): void {
  const seen = new Set<string>();
  for (const reference of references) {
    const key = referenceKey(reference);
    if (seen.has(key)) throw new Error(`Feature manifest contains duplicate ${kind} reference: ${key}`);
    seen.add(key);
  }
}

/** Validates static feature invariants and freezes the serializable manifest snapshot. */
export function defineAiFeature<Input extends AiJsonObject, Output extends AiJsonObject, PartialOutput extends AiJsonObject = Output>(
  definition: AiFeatureDefinition<Input, Output, PartialOutput>,
): DefinedAiFeature<Input, Output, PartialOutput> {
  const manifest = freezeCanonical(aiFeatureManifestSchema.parse(definition.manifest));
  const observationBindings = manifest.observations;
  const actionBindings = manifest.actions;
  const declaredObservations = definition.observations.map(({ binding }) => binding.observation);
  const declaredActions = definition.actions.map(({ binding }) => binding.action);
  const artifactDefinitions = definition.artifacts ?? [];

  ensureUniqueReferences("observation binding", observationBindings.map(({ observation }) => observation));
  ensureUniqueReferences("action binding", actionBindings.map(({ action }) => action));
  ensureUniqueReferences("artifact binding", manifest.artifacts.map(({ artifactType }) => artifactType));
  ensureUniqueReferences("observation definition", declaredObservations);
  ensureUniqueReferences("action definition", declaredActions);
  ensureUniqueReferences("artifact definition", artifactDefinitions.map(({ binding }) => binding.artifactType));

  for (const declared of definition.observations) {
    const binding = observationBindings.find(({ observation }) => sameReference(observation, declared.binding.observation));
    if (!binding || binding.delivery.kind !== "seed") throw new Error(`Observation builder must declare a seed binding: ${referenceKey(declared.binding.observation)}`);
  }

  for (const binding of observationBindings) {
    const delivery = binding.delivery;
    const declared = definition.observations.find(({ binding: candidate }) => sameReference(candidate.observation, binding.observation));
    if (delivery.kind === "seed" && !declared) throw new Error(`Feature manifest references a seed observation without a builder: ${referenceKey(binding.observation)}`);
    if (delivery.kind === "on_demand") {
      const action = actionBindings.find(({ action: candidate }) => sameReference(candidate, delivery.viaAction));
      if (!action || action.mode !== "invoke") throw new Error(`On-demand observation requires an invoke action: ${referenceKey(binding.observation)}`);
    }
    if (delivery.kind === "action_result") {
      const action = actionBindings.find(({ action: candidate }) => sameReference(candidate, delivery.fromAction));
      if (!action || action.mode !== "invoke") throw new Error(`Action-result observation requires an invoke action: ${referenceKey(binding.observation)}`);
    }
  }

  for (const binding of actionBindings) {
    const declared = definition.actions.find(({ binding: candidate }) => sameReference(candidate.action, binding.action));
    if (!declared) throw new Error(`Feature manifest references undeclared action: ${referenceKey(binding.action)}`);
    if (binding.mode === "invoke" && (!declared.inputSchema || !declared.execute)) {
      throw new Error(`Invoke action requires input schema and executor: ${referenceKey(binding.action)}`);
    }
  }

  for (const binding of manifest.artifacts) {
    if (!artifactDefinitions.some(({ binding: candidate }) => sameReference(candidate.artifactType, binding.artifactType))) {
      throw new Error(`Feature manifest references undeclared artifact resolver: ${referenceKey(binding.artifactType)}`);
    }
  }

  return Object.freeze({ ...definition, manifest, feature: manifest.feature, partialOutputSchema: definition.partialOutputSchema ?? definition.outputSchema }) as DefinedAiFeature<Input, Output, PartialOutput>;
}
