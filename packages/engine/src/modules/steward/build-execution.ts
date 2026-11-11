import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { runtimeHealthSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { StewardError } from "./errors";
import { assertProviderBinding, callProviderEndpoint, type ProviderBinding } from "./agent-provider";

export const buildExecutionSchema = z.object({
  provider: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  model: z.string().regex(/^[a-z0-9-]+\/[A-Za-z0-9._-]+$/),
  timeoutMinutes: z.number().int().min(1).max(120),
  maxSubmissions: z.number().int().min(1).max(20),
}).strict();
export type BuildExecution = z.infer<typeof buildExecutionSchema>;

/** Stored by the owner boundary, never read from the build's writable request.json. */
export async function buildExecution(db: Pick<StewardPorts["db"], "buildExecutionAdmission">, runId: string) {
  const receipt = await db.buildExecutionAdmission.findUnique({ where: { runId }, select: { provider: true, model: true, timeoutMinutes: true, maxSubmissions: true } });
  return receipt ? buildExecutionSchema.parse(receipt) : null;
}
/** Revalidate the immutable queue binding inside the writer, without calling module endpoints. */
export async function assertBuildProviderIn(tx: Prisma.TransactionClient, workspaceId: string, execution: BuildExecution, runId: string) {
  const binding = await tx.agentRunProvider.findFirst({ where: { runId, run: { workspaceId } } });
  if (!binding || binding.providerId !== execution.provider || binding.kind !== "conversation") throw new StewardError("conflict", "Authorized build Provider binding is unavailable");
  const declaration = await assertProviderBinding(tx, workspaceId, binding);
  if (!declaration.capabilities.conversation) throw new StewardError("conflict", "Authorized build Provider cannot run a conversation");
  return binding;
}

/** Live preflight performs module IO and must run outside any writer transaction. */
export async function assertBuildProvider(ports: StewardPorts, workspaceId: string, execution: BuildExecution, runId?: string) {
  let binding: ProviderBinding;
  if (runId) binding = await assertBuildProviderIn(ports.db, workspaceId, execution, runId);
  else {
    const registered = await ports.db.agentProvider.findUnique({ where: { workspaceId_id: { workspaceId, id: execution.provider } } });
    if (!registered) throw new StewardError("conflict", "Authorized build Provider is not registered");
    binding = { ...registered, providerId: registered.id };
    const declaration = await assertProviderBinding(ports.db, workspaceId, binding);
    if (!declaration.capabilities.conversation) throw new StewardError("conflict", "Authorized build Provider cannot run a conversation");
  }
  const health = runtimeHealthSchema.parse(await callProviderEndpoint(ports, workspaceId, binding, "health", {}));
  if (!health.available || !health.supportsRunModel) throw new StewardError("conflict", "Authorized build Provider cannot enforce this build's exact model");
  return binding;
}
