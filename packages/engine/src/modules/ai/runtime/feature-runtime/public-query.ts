import type { AiFeatureRunPublicRead, ReadAiFeatureRunPublicInput } from "../../feature-runtime/run-repository";
import { PrismaAiFeatureRunStore } from "./prisma-run-store";

/** Subject-scoped safe read with no runtime payload or provider internals. */
export async function readAiFeatureRunPublic(
  input: ReadAiFeatureRunPublicInput,
): Promise<AiFeatureRunPublicRead | null> {
  return new PrismaAiFeatureRunStore().readPublic(input);
}
