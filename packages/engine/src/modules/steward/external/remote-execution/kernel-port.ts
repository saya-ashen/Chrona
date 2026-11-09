import { bounded, canonical, check, KERNEL_TARGET, LIMITS, nativeDigest, ProtocolError, validate, type ModelInput, type DeviceFence, type Delivery, type KernelDeliveryPort, type KernelReceipt, type KernelRequest, type Report, type Target } from "./contracts";

/** Wire requests accepted by the routed host carrier. No body-supplied receiver identity. */
export type CarrierRequest = { operation: "poll"; limit: number }
  | { operation: "accept"; target: Target; key: string }
  | { operation: "started"; target: Target; key: string; processIdentity: Record<string, unknown> }
  | { operation: "source"; target: Target; key: string; records: unknown[] }
  | { operation: "final"; target: Target; key: string; final: Record<string, unknown> }
  | { operation: "stop"; target: Target; key: string; proof: Record<string, unknown> }
  | { operation: "acknowledge"; target: Target; key: string; controlKey: string }
  | { operation: "cleanup-report"; target: Target; key: string; controlKey: string; report: Record<string, unknown> }
  | { operation: "model"; target: Target; key: string; input: ModelInput }
  | { operation: "revoke"; key: string; subjectId: string; epoch: number; keyId: string; reason: string }
  | { operation: "cancel"; target: Target; key: string; reason: string }
  | { operation: "reconcile"; key: string; subjectId: string; epoch: number; keyId: string; snapshotId: string; page: number; complete: boolean; items: unknown[] };
export type RoutedCall = (target: string, args: Record<string, unknown>) => Promise<unknown>;

/** The app-private outbox is adapted explicitly; its envelope is never sent to the carrier. */
export class RoutedKernelPort implements KernelDeliveryPort {
  constructor(private readonly call: RoutedCall, private readonly targetFor: (deliveryId: string) => Target) {}
  private async invoke(request: CarrierRequest) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([this.call(KERNEL_TARGET, request), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ProtocolError("unavailable")), 2000); })]);
    } finally { clearTimeout(timer); }
  }
  async poll() {
    const raw = await this.invoke({ operation: "poll", limit: 2 });
    bounded(raw, LIMITS.body); validate("kernel-poll", raw); return raw;
  }
  async deliver(request: KernelRequest): Promise<KernelReceipt> {
    validate("kernel-request", request);
    const projection = (state: KernelReceipt["state"], result?: Record<string, unknown>): KernelReceipt => ({ version: 1, key: request.key, requestDigest: request.requestDigest, state, ...(result ? { result } : {}) });
    if (request.operation === "revoke") {
      const device = request.payload.device as DeviceFence;
      const raw = await this.invoke({ operation: "revoke", key: request.key, subjectId: device.deviceId, epoch: device.generation, keyId: device.keyId, reason: "owner-device-revoke" });
      validate("native-revoke-result", raw);
      const result = raw as { subjectId: string; epoch: number; keyId: string };
      check(result.subjectId === device.deviceId && result.epoch === device.generation && result.keyId === device.keyId, "kernel_receipt_mismatch");
      return projection("revoked", raw as Record<string, unknown>);
    }
    if (request.operation === "cancel") {
      const target = this.targetFor(String(request.payload.deliveryId));
      check(canonical(target) === canonical(request.payload.target), "fence_mismatch");
      const raw = await this.invoke({ operation: "cancel", target, key: request.key, reason: String(request.payload.reason) });
      validate("native-cancel-result", raw);
      return { ...projection("control-authorized", raw as Record<string, unknown>), control: { version: 1, requestId: request.key, deliveryId: target.deliveryId, launchDigest: target.launchDigest, control: { requestKey: (raw as { controlKey: string }).controlKey, operation: "control", payload: { operation: "cancel" } } } };
    }
    if (request.operation === "reconcile") {
      const p = request.payload, device = p.device as DeviceFence;
      const raw = await this.invoke({ operation: "reconcile", key: request.key, subjectId: device.deviceId, epoch: device.generation, keyId: device.keyId, snapshotId: String(p.snapshotId), page: Number(p.page), complete: Boolean(p.complete), items: p.items as unknown[] });
      validate("native-reconcile-result", raw);
      const result = raw as { reconciled: boolean; launchable: boolean; missing: string[] };
      check(result.reconciled === p.complete && (!result.launchable || (result.reconciled && result.missing.length === 0)), "kernel_receipt_mismatch");
      return projection(result.reconciled ? "reconciled" : "recorded", raw as Record<string, unknown>);
    }
    if (request.operation === "model") {
      const p = request.payload, target = this.targetFor(String(p.deliveryId));
      check(target.launchDigest === p.launchDigest, "fence_mismatch");
      const raw = await this.invoke({ operation: "model", target, key: String(p.key), input: p.input as ModelInput });
      validate("model-result", raw); bounded(raw, LIMITS.body);
      const result = raw as { status: string; result?: unknown };
      check(result.status === "completed" ? result.result !== undefined : result.result === undefined, "kernel_receipt_mismatch");
      return projection(result.status === "pending" ? "pending" : "recorded", raw as Record<string, unknown>);
    }
    if (request.operation === "accept") {
      const delivery = request.payload as unknown as Delivery;
      const raw = await this.invoke({ operation: "accept", key: request.key, target: delivery.packet.target });
      validate("native-accept-result", raw);
      check(canonical((raw as { target: Target }).target) === canonical(delivery.packet.target), "kernel_receipt_mismatch");
      return projection("recorded", raw as Record<string, unknown>);
    }
    const report = request.payload as unknown as Report, target = this.targetFor(report.deliveryId), base = { key: request.key, target };
    let wire: CarrierRequest, schema: string;
    switch (report.kind) {
      case "started": wire = { ...base, operation: "started", processIdentity: report.payload }; schema = "native-started-result"; break;
      case "source": wire = { ...base, operation: "source", records: report.payload.records as unknown[] }; schema = "native-source-result"; break;
      case "final": wire = { ...base, operation: "final", final: report.payload }; schema = "native-final-result"; break;
      case "stop": wire = { ...base, operation: "stop", proof: report.payload }; schema = "native-stop-result"; break;
      case "cleanup": wire = { ...base, operation: "cleanup-report", controlKey: String(report.payload.controlKey), report: report.payload.report as Record<string, unknown> }; schema = "cleanup-receipt"; break;
      case "control-ack": wire = { ...base, operation: "acknowledge", controlKey: String(report.payload.controlKey) }; schema = "native-ack-result"; break;
    }
    const raw = await this.invoke(wire); validate(schema, raw);
    if (report.kind === "cleanup") check(canonical(raw) === canonical(report.payload.report), "kernel_receipt_mismatch");
    if (report.kind === "started") check(canonical((raw as { target: Target }).target) === canonical(target), "kernel_receipt_mismatch");
    if (report.kind === "source") check((raw as { throughSourceSeq: number }).throughSourceSeq === (report.payload.records as { sequence: number }[]).at(-1)!.sequence, "kernel_receipt_mismatch");
    if (report.kind === "final") check((raw as { finalDigest: string }).finalDigest === nativeDigest(report.payload), "kernel_receipt_mismatch");
    if (report.kind === "stop") check((raw as { finalDigest: string; stopDigest: string }).finalDigest === (report.payload.statement as { finalDigest: string }).finalDigest && (raw as { stopDigest: string }).stopDigest === nativeDigest(report.payload), "kernel_receipt_mismatch");
    if (report.kind === "control-ack") check((raw as { controlKey: string }).controlKey === report.payload.controlKey, "kernel_receipt_mismatch");
    return projection("recorded", raw as Record<string, unknown>);
  }
}
