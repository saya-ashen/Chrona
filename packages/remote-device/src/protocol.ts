import { createHash, sign } from "node:crypto";
import { z } from "zod";
import { executionDeliveryTargetSchema, executionLaunchSchema, executionDeliveryFinalSchema, executionSignedStopSchema, executionDeliverySourceSchema, kernelCleanupInputSchema, kernelCleanupReceiptSchema, providerAnswerSchema, type ExecutionDeliveryTarget, type ExecutionDeliveryFinal } from "@chrona/contracts/steward";

export const deviceSchema = z.object({ deviceId: z.string().min(1).max(200), generation: z.number().int().positive(), incarnation: z.string().min(1).max(200), keyId: z.string().min(1).max(200) }).strict();
export type DeviceFence = z.infer<typeof deviceSchema>;
export const controlSchema = z.discriminatedUnion("operation", [
  z.object({ requestKey: z.string().min(1).max(200), operation: z.literal("control"), payload: z.discriminatedUnion("operation", [z.object({ operation: z.literal("cancel") }).strict(), z.object({ operation: z.literal("write"), text: z.string().max(20000) }).strict(), z.object({ operation: z.literal("answer"), requestId: z.string(), answer: providerAnswerSchema }).strict()]) }).strict(),
  z.object({ requestKey: z.string().min(1).max(200), operation: z.literal("cleanup"), payload: kernelCleanupInputSchema }).strict(),
]);
const packetSchema = z.object({ target: executionDeliveryTargetSchema, launch: executionLaunchSchema, launchable: z.boolean(), controls: z.array(controlSchema).max(100) }).strict();
export const deliverySchema = z.object({ version: z.literal(1), requestId: z.string().min(1).max(128), deliveryId: z.string().min(1).max(200), launchDigest: z.string().regex(/^[a-f0-9]{64}$/), packet: packetSchema }).strict();
export type Delivery = z.infer<typeof deliverySchema>;
export const controlEnvelopeSchema = deliverySchema.omit({ packet: true }).extend({ control: controlSchema }).strict();
export const pollSchema = z.object({ version: z.literal(1), state: z.literal("offered"), reconciliationRequired: z.boolean(), messages: z.array(z.discriminatedUnion("kind", [z.object({ messageKey: z.string(), kind: z.literal("launch"), localWorkspaceRef: z.string().min(1).max(200), envelope: deliverySchema }).strict(), z.object({ messageKey: z.string(), kind: z.literal("control"), localWorkspaceRef: z.string().min(1).max(200), envelope: controlEnvelopeSchema }).strict()])).max(100) }).strict();
export const receiptSchema = z.object({ version: z.literal(1), requestId: z.string(), receiptId: z.string(), requestDigest: z.string().regex(/^[a-f0-9]{64}$/), committedAt: z.string().datetime({ offset: true }), state: z.string() });
export const reportSchema = z.object({ version: z.literal(1), requestId: z.string(), deliveryId: z.string(), launchDigest: z.string().regex(/^[a-f0-9]{64}$/), reportKey: z.string(), kind: z.enum(["started", "source", "final", "stop", "control-ack", "cleanup"]), payload: z.record(z.string(), z.unknown()) }).strict();
export type Report = z.infer<typeof reportSchema>;

/** Kernel v1 executionDigest: localeCompare ordering, then ECMAScript JSON. */
export function executionDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest("hex");
}
/** Application transport receipt digest deliberately uses JCS code-unit ordering. */
export function appCanonical(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Error("Unpaired JSON surrogate");
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error("Unsafe JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(appCanonical).join(",")}]`;
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Non-JSON value");
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${appCanonical(key)}:${appCanonical(object[key])}`).join(",")}}`;
}
export function appDigest(value: unknown): string { return createHash("sha256").update(appCanonical(value)).digest("hex"); }
export function validateDelivery(input: unknown, device: DeviceFence): Delivery {
  const value = deliverySchema.parse(input), { target, launch } = value.packet;
  const { launchDigest, ...fence } = target;
  if (value.deliveryId !== target.deliveryId || value.launchDigest !== launchDigest || executionDigest(launch) !== launchDigest || executionDigest(fence) !== executionDigest(launch.fence)) throw new Error("Immutable launch digest/fence mismatch");
  if (target.subjectId !== device.deviceId || target.epoch !== device.generation || target.keyId !== device.keyId) throw new Error("Device authority fence mismatch");
  if (launch.placement.kind !== "application" || launch.placement.applicationId !== target.receiverModuleId || launch.placement.targetRef !== launch.target.targetRef || launch.placement.targetRevision !== launch.target.targetRevision || launch.placement.projectRef !== launch.target.projectRef || executionDigest(launch.workspace.baseline) !== executionDigest(launch.target.baseline) || !launch.target.workspaceModes.includes(launch.workspace.mode)) throw new Error("Launch placement exceeds immutable target");
  return value;
}
export function validateReport(report: Report) {
  switch (report.kind) {
    case "started": z.object({ id: z.string().min(1), scope: z.string().min(1) }).strict().parse(report.payload); break;
    case "source": executionDeliverySourceSchema.parse(report.payload.records); break;
    case "final": executionDeliveryFinalSchema.parse(report.payload); break;
    case "stop": executionSignedStopSchema.parse(report.payload); break;
    case "control-ack": z.object({ controlKey: z.string().min(1) }).strict().parse(report.payload); break;
    case "cleanup": z.object({ controlKey: z.string().min(1), report: kernelCleanupReceiptSchema }).strict().parse(report.payload); break;
  }
}
export function stopProof(target: ExecutionDeliveryTarget, final: ExecutionDeliveryFinal, processIdentity: { id: string; scope: string } | null, privateKey: string, observedAt: string) {
  const statement = { target, kind: processIdentity ? "exited" as const : "never_started" as const, processIdentity, finalDigest: executionDigest(final), sourceThrough: final.throughSourceSeq, observedAt };
  return executionSignedStopSchema.parse({ statement, signature: sign(null, Buffer.from(executionDigest(statement), "hex"), privateKey).toString("base64") });
}
