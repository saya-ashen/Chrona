import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MODULE_CALL_ERRORS, compileModuleOutput, moduleManifestSchema, executionReceiverSchema, executionDeliveryTargetSchema, executionIdSchema, executionProcessIdentitySchema, executionDeliverySourceSchema, executionDeliveryFinalSchema, executionSignedStopSchema, executionDeliveryModelSchema, kernelCleanupReceiptSchema, type ExecutionReceiver, type ModuleEvent } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { moduleSupervisor, type CallScope } from "./module-supervisor";
import { CallError } from "./module-call-error";
import { createExecutionDelivery } from "./execution-delivery";
import { createExecutionDeliveryGovernance, executionGovernanceRequests } from "./execution-delivery-governance";
import { validateToolArgs } from "./module-tool-contract";

/** Private channel capability, deliberately absent from module discovery and the system namespace. */
export const EXECUTION_DELIVERY_CARRIER = "runtime-callback.remote-delivery";
const base = { target: executionDeliveryTargetSchema, key: executionIdSchema };
const requestSchema = z.discriminatedUnion("operation", [
  ...executionGovernanceRequests,
  z.object({ operation: z.literal("poll"), limit: z.number().int().min(1).max(50).optional() }).strict(),
  z.object({ operation: z.literal("accept"), ...base }).strict(),
  z.object({ operation: z.literal("started"), ...base, processIdentity: executionProcessIdentitySchema }).strict(),
  z.object({ operation: z.literal("source"), ...base, records: executionDeliverySourceSchema }).strict(),
  z.object({ operation: z.literal("final"), ...base, final: executionDeliveryFinalSchema }).strict(),
  z.object({ operation: z.literal("stop"), ...base, proof: executionSignedStopSchema }).strict(),
  z.object({ operation: z.literal("acknowledge"), ...base, controlKey: executionIdSchema }).strict(),
  z.object({ operation: z.literal("model"), ...base, input: executionDeliveryModelSchema }).strict(),
  z.object({ operation: z.literal("cleanup-report"), ...base, controlKey: executionIdSchema, report: kernelCleanupReceiptSchema }).strict(),
]);

export async function assertExecutionReceiver(ports: StewardPorts, raw: ExecutionReceiver, drain = false) {
  const who = executionReceiverSchema.parse(raw);
  const module = await ports.db.module.findFirst({ where: { id: who.moduleId, workspaceId: who.workspaceId, activeHash: who.hash, activationId: who.activationId, ...(drain ? {} : { status: "active" }) } });
  const version = module && await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: who.moduleId, hash: who.hash } } });
  if (!module || version?.status !== "approved") throw new CallError("forbidden", "Execution receiver activation is unavailable");
  return { module, manifest: moduleManifestSchema.parse(version.manifest) };
}

/** Only handleModuleCall supplies this scope, captured when the actual module process starts. */
export async function callExecutionDeliveryCarrier(ports: StewardPorts, scope: CallScope, raw: unknown) {
  if (!scope.receiverActivationId) throw new CallError("forbidden", "Execution receiver has no process activation");
  const who = { workspaceId: scope.workspaceId, moduleId: scope.moduleId, hash: scope.hash, activationId: scope.receiverActivationId };
  if (Buffer.byteLength(JSON.stringify(raw)) > 524_288) throw new CallError("too_large", "Execution carrier request exceeds byte limit");
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) throw new CallError("invalid", "Invalid execution delivery carrier request");
  const input = parsed.data;
  await assertExecutionReceiver(ports, who, !["accept", "started", "model"].includes(input.operation));
  switch (input.operation) {
    case "revoke": case "cancel": case "reconcile": case "retention": return createExecutionDeliveryGovernance(ports)(who, input);
    default: return dispatchDelivery(ports, who, input);
  }
}

function dispatchDelivery(ports: StewardPorts, who: ExecutionReceiver, input: Exclude<z.infer<typeof requestSchema>, { operation: "revoke" | "cancel" | "reconcile" | "retention" }>) {
  const delivery = createExecutionDelivery(ports);
  switch (input.operation) {
    case "poll": return delivery.poll(who, input.limit);
    case "accept": return delivery.accept(who, input.target, input.key);
    case "started": return delivery.started(who, input.target, input.key, input.processIdentity);
    case "source": return delivery.source(who, input.target, input.key, input.records);
    case "final": return delivery.final(who, input.target, input.key, input.final);
    case "stop": return delivery.stop(who, input.target, input.key, input.proof);
    case "acknowledge": return delivery.acknowledge(who, input.target, input.key, input.controlKey);
    case "model": return delivery.model(who, input.target, input.key, input.input);
    case "cleanup-report": return delivery.cleanupReport(who, input.target, input.key, input.controlKey, input.report);
  }
}

/** Host-only event delivery. Credentials never enter the generic invocation/audit argument store. */
export async function deliverExecutionApplication(ports: StewardPorts, who: ExecutionReceiver, toolName: string, raw: unknown, caller: "kernel" | "owner" = "kernel") {
  const { manifest } = await assertExecutionReceiver(ports, who);
  const tool = manifest.tools.find(item => item.name === toolName);
  if (!tool || !tool.visibility.includes(caller)) throw new CallError("forbidden", "Execution application does not admit the trusted caller");
  const args = validateToolArgs(tool, raw), now = ports.now().toISOString();
  const event: ModuleEvent = { trigger: { kind: "tool", id: toolName, firedAt: now, args, caller: caller === "owner" ? { kind: "owner", via: null } : { kind: "kernel" }, call: { id: randomUUID(), key: null, attempt: 1, chain: [] } }, now, params: {} };
  const reply = await moduleSupervisor(ports).deliver(who.moduleId, who.hash, event, {
    beforeDelivery: async () => { await assertExecutionReceiver(ports, who); },
    validateResult: result => !tool.output || compileModuleOutput(tool.output as Record<string, unknown>).safeParse(result).success ? null : "Execution application output contract mismatch",
  }).catch((error: unknown) => {
    const failure = error as { stage?: string; code?: string };
    const code = MODULE_CALL_ERRORS.find(candidate => candidate === failure.code);
    throw new CallError(failure.stage === "handler" && code ? code : "unavailable", "Execution application delivery failed");
  });
  if ("error" in reply) throw new CallError("failed", "Execution application rejected delivery");
  return reply.result.result ?? null;
}
