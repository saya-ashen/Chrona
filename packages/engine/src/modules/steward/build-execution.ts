import { z } from "zod";
import type { StewardPorts } from "./ports";
import { StewardError } from "./errors";

export const buildExecutionSchema = z.object({
  provider: z.literal("pi"),
  model: z.string().regex(/^[a-z0-9-]+\/[A-Za-z0-9._-]+$/),
  timeoutMinutes: z.number().int().min(1).max(120),
  maxSubmissions: z.number().int().min(1).max(20),
}).strict();
export type BuildExecution = z.infer<typeof buildExecutionSchema>;

/** Stored by the owner boundary, never read from the build's writable request.json. */
export async function buildExecution(db: Pick<StewardPorts["db"], "audit">, runId: string) {
  const receipt = await db.audit.findUnique({ where: { id: `build-execution:${runId}` } });
  return receipt ? buildExecutionSchema.parse(receipt.details) : null;
}
export function assertBuildProvider(ports: StewardPorts, execution: BuildExecution) {
  if (ports.provider?.name !== execution.provider || !ports.provider.supportsRunModel) throw new StewardError("conflict", "Configured Provider cannot enforce this build's exact model");
}
