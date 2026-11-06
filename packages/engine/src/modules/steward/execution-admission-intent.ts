import { randomUUID } from "node:crypto";
import type { Prisma } from "@chrona/db";
import { z } from "zod";
import type { ExecutionPrincipal } from "@chrona/contracts/steward";
import { executionCallerKey, executionDigest } from "./execution-state";
import { CallError } from "./module-calls";

const kind = "execution_admission_intent";
const maxIntents = 1024, maxIntentBytes = 1024;
const intentSchema = z.object({ version: z.literal(1), principalDigest: z.string().regex(/^[a-f0-9]{64}$/), requestDigest: z.string().regex(/^[a-f0-9]{64}$/), grantDigest: z.string().regex(/^[a-f0-9]{64}$/), attemptId: z.string().uuid(), workspaceRef: z.string().uuid() }).strict();
/** Original command identity survives preparation failure; this is never a scheduling source. */
export async function executionAdmissionIntent(tx: Prisma.TransactionClient, principal: ExecutionPrincipal, input: { commandKey: string; requestDigest: string; grantDigest: string; now: Date }) {
  const id = `execution-admission:${executionDigest([principal.workspaceId, principal.ownerId, executionCallerKey(principal), input.commandKey])}`;
  const prior = await tx.audit.findUnique({ where: { id } });
  if (prior) {
    const parsed = intentSchema.safeParse(prior.details);
    if (!parsed.success || prior.kind !== kind || prior.workspaceId !== principal.workspaceId) throw new CallError("unavailable", "Stored execution admission intent is invalid");
    if (parsed.data.principalDigest !== executionDigest(principal) || parsed.data.requestDigest !== input.requestDigest || parsed.data.grantDigest !== input.grantDigest) throw new CallError("conflict", "Start key belongs to a different preparation request");
    return parsed.data;
  }
  if (await tx.audit.count({ where: { kind } }) >= maxIntents) throw new CallError("capacity", "Execution admission intent capacity exhausted");
  const intent = { version: 1 as const, principalDigest: executionDigest(principal), requestDigest: input.requestDigest, grantDigest: input.grantDigest, attemptId: randomUUID(), workspaceRef: randomUUID() };
  if (Buffer.byteLength(JSON.stringify(intent)) > maxIntentBytes) throw new CallError("capacity", "Execution admission intent exceeds byte limit");
  await tx.audit.create({ data: { id, workspaceId: principal.workspaceId, actorKey: "chrona", kind, subjectId: intent.attemptId, details: intent, createdAt: input.now } });
  return intent;
}
