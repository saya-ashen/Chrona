import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appDigest, deviceSchema, pollSchema, receiptSchema, type DeviceFence, type Report } from "./protocol";
import { serverURL } from "./config";
import { receiptSchema as modelReceiptSchema, type ModelInput } from "@chrona/remote-model";
import type { Delivery } from "./protocol";

export class DeviceHTTPError extends Error {
  constructor(readonly status: number) { super(`Device endpoint returned HTTP ${status}`); }
}
export interface Transport {
  poll(): Promise<z.infer<typeof pollSchema>>;
  report(report: Report): Promise<unknown>;
  reconcile(items: SnapshotItem[]): Promise<unknown>;
  model?(delivery: Delivery, key: string, input: ModelInput): Promise<unknown>;
}
export type SnapshotItem = { deliveryId: string; launchDigest: string; state: "intent" | "spawn_possible" | "running" | "unknown" | "stopped"; journalSeq: number; sourceWatermark: number };

/** App bearer only. Never uses owner APIs, API_KEY, or model-provider credentials. */
export class DeviceHTTP implements Transport {
  private readonly origin: string;
  constructor(server: string, private readonly credential: string, private readonly device: DeviceFence | null, private readonly signal?: AbortSignal) {
    this.origin = serverURL(server);
    if (!/^[A-Za-z0-9_-]{43}$/.test(credential)) throw new Error("Invalid device bearer");
  }
  private async post(operation: "pair" | "poll" | "report" | "reconcile" | "model", body: unknown): Promise<unknown> {
    const response = await fetch(`${this.origin}/api/remote-execution/device/v1/${operation}`, { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${this.credential}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
    if (!response.ok) { await response.body?.cancel(); throw new DeviceHTTPError(response.status); }
    if (!response.body) throw new Error("Missing device endpoint body");
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const item = await reader.read(); if (item.done) break;
        size += item.value.byteLength;
        if (size > 524288) { await reader.cancel(); throw new Error("Device endpoint response exceeds byte limit"); }
        chunks.push(item.value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  }
  async pair(code: string, publicKey: string, requestId: string) {
    const raw = await this.post("pair", { version: 1, requestId, code, publicKey });
    const receipt = receiptSchema.extend({ device: deviceSchema }).parse(raw);
    const expected = appDigest({ version: 1, codeHash: hashSecret(code), credentialHash: hashSecret(this.credential), publicKey });
    if (receipt.requestDigest !== expected || receipt.state !== "paired-reconciliation-required") throw new Error("Pairing receipt mismatch");
    // A consumed pairing may return the original transport requestId on retry.
    return receipt;
  }
  private auth(requestId: string = randomUUID()) {
    if (!this.device) throw new Error("Device is not paired");
    return { version: 1 as const, requestId, device: this.device };
  }
  async model(delivery: Delivery, key: string, input: ModelInput) {
    // The caller supplies the saved delivery; the request cannot replace any
    // principal, receiver, model/provider or native target fence.
    return modelReceiptSchema.parse(await this.post("model", { ...this.auth(), deliveryId: delivery.deliveryId, launchDigest: delivery.launchDigest, key, input }));
  }
  async poll() { return pollSchema.parse(await this.post("poll", this.auth())); }
  async report(report: Report) {
    const raw = await this.post("report", { ...this.auth(report.requestId), report }), receipt = receiptSchema.parse(raw);
    const { requestId: _, reportKey: __, ...business } = report;
    if (receipt.requestDigest !== appDigest(business) || receipt.requestId !== report.requestId || receipt.state !== "durably-received-evidence-unverified") throw new Error("Report receipt mismatch");
    return receipt;
  }
  async reconcile(items: SnapshotItem[]) {
    if (items.length > 100) throw new Error("Reconciliation snapshot capacity exceeded");
    const request = { ...this.auth(), snapshotId: randomUUID(), page: 0, complete: true, items };
    const raw = await this.post("reconcile", request), receipt = receiptSchema.extend({ missing: z.array(z.string()).max(100) }).parse(raw);
    if (receipt.requestId !== request.requestId || receipt.requestDigest !== appDigest(request) || !["kernel-reconciliation-pending", "unknown-missing-journal"].includes(receipt.state)) throw new Error("Reconciliation receipt mismatch");
    if (receipt.missing.length || receipt.state === "unknown-missing-journal") throw new Error("Reconciliation found missing device journal; launches remain blocked");
    return receipt;
  }
}
import { createHash } from "node:crypto";
function hashSecret(value: string) { return createHash("sha256").update(value).digest("hex"); }
