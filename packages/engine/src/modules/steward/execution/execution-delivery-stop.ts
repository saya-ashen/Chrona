import { createPublicKey, verify } from "node:crypto";
import type { Prisma } from "@chrona/db";
import type { ExecutionDeliveryTarget, ExecutionSignedStop } from "@chrona/contracts/steward";
import { executionDigest } from "./execution-delivery-digest";
import { CallError } from "../modules/module-call-error";

import type { VerifiedExecutionStop } from "./execution-delivery-stop-types";
const verified = new WeakSet<object>();
export function assertVerifiedExecutionStop(value: VerifiedExecutionStop, attemptId: string) {
  if (!verified.has(value) || value.target.attemptId !== attemptId) throw new CallError("forbidden", "Stop evidence was not verified by the kernel");
}
/** Called in the same transaction as settlement. App authentication never establishes stop authority. */
export async function verifyExecutionStop(tx: Prisma.TransactionClient, target: ExecutionDeliveryTarget, proof: ExecutionSignedStop): Promise<VerifiedExecutionStop> {
  const delivery = await tx.executionDelivery.findUniqueOrThrow({ where: { id: target.deliveryId }, include: { authority: true } });
  const authority = delivery.authority, statement = proof.statement;
  if (authority.verifierId !== "ed25519" || authority.verifierVersion !== "1" || executionDigest(statement.target) !== executionDigest(target) || statement.finalDigest !== delivery.finalDigest || statement.sourceThrough < delivery.sourceThrough) throw new CallError("conflict", "Stop proof fence or final mismatch");
  if (statement.kind === "exited" && (!delivery.startedAt || !delivery.processIdentity || executionDigest(statement.processIdentity) !== executionDigest(delivery.processIdentity))) throw new CallError("conflict", "Stop proof process mismatch");
  if (statement.kind === "never_started" && (delivery.startedAt || delivery.processIdentity || statement.processIdentity !== null)) throw new CallError("conflict", "Started execution requires process exit evidence");
  let valid = false;
  try { const key = createPublicKey(authority.publicKey); valid = key.asymmetricKeyType === "ed25519" && verify(null, Buffer.from(executionDigest(statement), "hex"), key, Buffer.from(proof.signature, "base64")); } catch { /* Invalid keys/signatures are refused below. */ }
  if (!valid) throw new CallError("forbidden", "Stop proof signature is invalid");
  const result = Object.freeze({ target, digest: executionDigest(proof), statement }) as VerifiedExecutionStop;
  verified.add(result);
  return result;
}
