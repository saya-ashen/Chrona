import { runtimeCompletionSchema, runtimeOperationSchema, runtimeOutcomeSchema } from "@chrona/contracts/steward";
import { z } from "zod";
import type { ProviderDeclaration } from "./agent-provider";
import { CallError } from "../modules/module-call-error";

type Endpoint = <T>(name: keyof ProviderDeclaration["endpoints"], args: Record<string, unknown>, key?: string) => Promise<T>;
const statusSchema = runtimeOperationSchema.extend({ outcome: runtimeOutcomeSchema.nullable(), failure: z.boolean(),
  completion: runtimeCompletionSchema.optional() });
const unknown = () => new CallError("unknown", "Provider completion requires reconciliation");

/** Observe a single submission. An abort acknowledgement never proves closure. */
export async function awaitRegisteredCompletion(endpoint: Endpoint, operationId: string, request: Record<string, unknown>, timeoutMs: number) {
  const expires = Date.now() + timeoutMs;
  const raw = await bounded(endpoint("complete", request, `provider-complete:${operationId}`).catch(error => {
    if (error instanceof CallError && error.code === "unknown") {
      console.error(JSON.stringify({ component: "provider-completion", event: "submit.unknown", operationId, error: String(error) }));
      return null;
    }
    throw error;
  }), expires);
  const synchronous = runtimeCompletionSchema.safeParse(raw);
  if (synchronous.success) return { result: synchronous.data };
  const receipt = runtimeOperationSchema.safeParse(raw);
  if (raw !== null && (!receipt.success || receipt.data.operationId !== operationId)) throw unknown();
  return reconcileCompletion(endpoint, operationId, expires);
}

async function reconcileCompletion(endpoint: Endpoint, operationId: string, expires: number) {
  let stopDeadline: number | undefined;
  for (;;) {
    if (stopDeadline === undefined && Date.now() >= expires) {
      stopDeadline = Date.now() + 5_000;
      await bounded(endpoint("abort", { operationId }).catch(error => {
        console.error(JSON.stringify({ component: "provider-completion", event: "abort.failed", operationId, error: String(error) }));
        return null;
      }), Math.min(stopDeadline, Date.now() + 1_000));
    }
    const deadline = stopDeadline ?? expires;
    const raw = await bounded(endpoint("status", { operationId }).catch(error => {
      console.error(JSON.stringify({ component: "provider-completion", event: "status.failed", operationId, error: String(error) }));
      return null;
    }), deadline);
    const settled = completionStatus(raw, operationId, stopDeadline !== undefined);
    if (settled) return settled;
    if (stopDeadline !== undefined && Date.now() >= stopDeadline) throw unknown();
    await new Promise<void>(resolve => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
  }
}

function completionStatus(raw: unknown, operationId: string, stopped: boolean) {
  if (raw === null) return null;
  const status = statusSchema.safeParse(raw);
  if (!status.success || status.data.operationId !== operationId) throw unknown();
  const { outcome, completion, failure } = status.data;
  if (!outcome) { if (failure) throw unknown(); return null; }
  if (outcome.outcome === "finished") {
    if (!completion) throw unknown();
    return { result: completion };
  }
  return { outcome: stopped && outcome.outcome === "failed" ? { ...outcome, outcome: "timed_out" as const } : outcome };
}

/** Every external call, including abort/status, shares a bounded observation deadline. */
async function bounded<T>(pending: Promise<T>, deadline: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), Math.max(1, deadline - Date.now())); })]);
  } finally { clearTimeout(timer); }
}

/** Best-effort handle cleanup follows durable settlement, and cannot extend the deadline indefinitely. */
export async function releaseRegisteredCompletion(endpoint: Endpoint, operationId: string) {
  await bounded(endpoint("release", { operationId }).catch(error => {
    console.error(JSON.stringify({ component: "provider-completion", event: "release.failed", operationId, error: String(error) }));
    return null;
  }), Date.now() + 1_000);
}
