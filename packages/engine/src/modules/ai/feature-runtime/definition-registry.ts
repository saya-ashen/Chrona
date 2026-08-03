import type { AiContractRef } from "@chrona/contracts/ai-feature-runtime";
import type { DefinedAiFeature } from "./define-feature";
import { sameAiContractRef } from "./identifiers";

/** Immutable lookup of engine-owned feature definitions by ID and version. */
export class AiFeatureDefinitionRegistry {
  private readonly definitions = new Map<string, DefinedAiFeature>();

  constructor(definitions: readonly DefinedAiFeature[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: DefinedAiFeature): void {
    const key = `${definition.feature.id}:${definition.feature.version}`;
    if (this.definitions.has(key)) throw new Error(`AI feature definition is already registered: ${key}`);
    this.definitions.set(key, definition);
  }

  get(feature: AiContractRef): DefinedAiFeature | undefined {
    return this.definitions.get(`${feature.id}:${feature.version}`);
  }

  require(feature: AiContractRef): DefinedAiFeature {
    const definition = this.get(feature);
    if (!definition) throw new Error(`AI feature definition is not registered: ${feature.id}:${feature.version}`);
    if (!sameAiContractRef(definition.feature, feature)) throw new Error("AI feature registry returned an inconsistent definition.");
    return definition;
  }

  values(): readonly DefinedAiFeature[] {
    return [...this.definitions.values()];
  }
}
