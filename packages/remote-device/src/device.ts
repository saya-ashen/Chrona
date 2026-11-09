import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { prepareLockedLocalWorkspace, recoverWorkspaceLocks } from "@chrona/workspaces";
import { executionDeliveryFinalSchema, type ExecutionDeliveryFinal, type ExecutionPayload } from "@chrona/contracts/steward";
import { loadConfig, type DeviceConfig } from "./config";
import { governedPiDriver, type LaunchDriver, type ProcessHandle } from "./driver";
import { DeviceDirectoryLock, Journal, type Attempt } from "./journal";
import { appDigest, controlEnvelopeSchema, executionDigest, stopProof, validateDelivery, type Delivery, type Report } from "./protocol";
import type { Transport } from "./transport";
import { executeCleanup } from "./cleanup";
import { workspaceInput } from "./workspace";
import { receiptSchema as modelReceiptSchema } from "@chrona/remote-model";

function textPrefix(text: string, limit: number): string {
  const end = Math.min(text.length, limit), last = text.charCodeAt(end - 1);
  return text.slice(0, end < text.length && last >= 0xD800 && last <= 0xDBFF ? end - 1 : end);
}
type Active = { process: ProcessHandle; done: Promise<void>; release: () => void; cancelled: boolean; text: string; truncated: boolean; missing: boolean };
export class RemoteDevice {
  readonly journal: Journal;
  private readonly lock: DeviceDirectoryLock;
  private readonly active = new Map<string, Active>();
  private reconciled = false;
  private reconciledSnapshot: string | null = null;
  private initialized = false;
  private closed = false;
  private ticking = false;
  constructor(readonly root: string, readonly config: DeviceConfig, private readonly transport: Transport, private readonly driver: LaunchDriver = governedPiDriver) {
    if (process.platform !== "linux") throw new Error("Only local Linux execution has been verified");
    if (!config.device) throw new Error("Device must be paired before serving");
    this.lock = new DeviceDirectoryLock(root);
    let journal: Journal | undefined;
    try {
      if (executionDigest(loadConfig(root)) !== executionDigest(config)) throw new Error("Device configuration must be durably saved before serving");
      journal = new Journal(root); this.journal = journal; journal.bind(config.device);
      for (const attempt of this.journal.attempts()) validateDelivery(attempt.delivery, config.device);
    } catch (error) { journal?.close(); this.lock.close(); throw error; }
  }
  private owner(delivery: Delivery) { return { device: this.config.device, deliveryId: delivery.deliveryId, launchDigest: delivery.launchDigest }; }
  private report(delivery: Delivery, kind: Report["kind"], payload: Record<string, unknown>, reportKey: string = kind): Report {
    return { version: 1, requestId: randomUUID(), deliveryId: delivery.deliveryId, launchDigest: delivery.launchDigest, reportKey, kind, payload };
  }
  /** Final, signature and stopped state are one FULL-synchronous commit. */
  private finish(attempt: Attempt, final: ExecutionDeliveryFinal, identity: ProcessHandle["identity"] | null) {
    const proof = stopProof(attempt.delivery.packet.target, final, identity, this.config.privateKey, new Date().toISOString());
    this.journal.write(() => {
      this.journal.enqueue(this.report(attempt.delivery, "final", final));
      this.journal.enqueue(this.report(attempt.delivery, "stop", proof, `stop:${appDigest(proof)}`));
      this.journal.transition(attempt.delivery.deliveryId, "stopped");
    });
  }
  private neverStarted(attempt: Attempt, reason: string, outcome: "unavailable" | "cancelled" | "timed_out" = "unavailable") {
    if (attempt.state !== "intent") throw new Error("Cannot assert never_started after spawn_possible");
    this.finish(attempt, { outcome, error: reason.slice(0, 1000), throughSourceSeq: attempt.sourceWatermark, baseline: attempt.delivery.packet.launch.workspace.baseline, finalMessage: null, missing: false }, null);
    recoverWorkspaceLocks(join(this.root, "workspaces"), this.owner(attempt.delivery), attempt.locks);
  }
  private recover() {
    if (this.initialized) return;
    for (const attempt of this.journal.attempts()) {
      if (attempt.state === "intent") this.neverStarted(attempt, "Restart before spawn boundary; retained launch intent was not replayed");
      else if (["spawn_possible", "running"].includes(attempt.state)) this.journal.transition(attempt.delivery.deliveryId, "unknown");
      else if (attempt.state === "stopped") recoverWorkspaceLocks(join(this.root, "workspaces"), this.owner(attempt.delivery), attempt.locks);
      // unknown retains both capacity and workspace locks. PID/deadline/network
      // guesses cannot recover the native guardian's lost stop certificate.
    }
    this.initialized = true;
  }
  private snapshot() {
    return this.journal.attempts().map(attempt => ({ deliveryId: attempt.delivery.deliveryId, launchDigest: attempt.delivery.launchDigest, state: attempt.state, journalSeq: attempt.journalSeq, sourceWatermark: attempt.sourceWatermark }));
  }
  private async reconcile() {
    const items = this.snapshot();
    await this.transport.reconcile(items); this.reconciledSnapshot = executionDigest(items); this.reconciled = true;
  }
  async flush() {
    for (const pending of this.journal.pending()) {
      const receipt = await this.transport.report(pending.report);
      this.journal.acknowledge(pending.id, receipt);
      // Durable app receipt acknowledges custody, not kernel-verified stop.
      // Rows and evidence are retained locally, including acknowledged reports.
    }
  }
  async tick() {
    if (this.closed || this.ticking) throw new Error("Device is closed or already polling");
    this.ticking = true;
    try {
      this.recover();
      let failure: unknown;
      if (!this.reconciled) {
        try { await this.reconcile(); } catch (error) { failure = error; }
      }
      let poll: Awaited<ReturnType<Transport["poll"]>>;
      try { poll = await this.transport.poll(); }
      catch (error) { await this.flush().catch(() => {}); throw error; }
      if (poll.reconciliationRequired) {
        this.reconciled = false;
        try { await this.reconcile(); } catch (error) { failure = error; }
      }
      const candidates: string[] = [];
      // Persist the whole offered launch identity before applying packet controls.
      // Poll may place cancel controls before their matching launch.
      for (const message of poll.messages) if (message.kind === "launch") {
        try {
          const delivery = validateDelivery(message.envelope, this.config.device!);
          if (!this.reconciled || poll.reconciliationRequired || failure) continue;
          const cancelled = delivery.packet.controls.some(control => control.operation === "control" && control.payload.operation === "cancel") || poll.messages.some(item => item.kind === "control" && item.envelope.deliveryId === delivery.deliveryId && item.envelope.launchDigest === delivery.launchDigest && item.envelope.control.operation === "control" && item.envelope.control.payload.operation === "cancel");
          // The app can relay a held claim cancelled before its first device
          // offer. Journal its exact identity only after the ready/reconciliation
          // barrier; ordinary cancel handling can then prove never_started.
          // Missing old journal evidence fails that barrier, while existing
          // spawn_possible/running/unknown attempts keep their original state.
          if (!delivery.packet.launchable && !cancelled) continue;
          const accepted = this.journal.accept(delivery, message.localWorkspaceRef, this.reconciledSnapshot === executionDigest(this.snapshot()));
          if (delivery.packet.launchable && accepted.attempt.state === "intent") candidates.push(delivery.deliveryId);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("Receiver activation fence changed")) this.reconciled = false;
          failure ??= error;
        }
      }
      const drain = async (envelope: unknown) => { try { await this.control(envelope); } catch (error) { failure ??= error; } };
      for (const message of poll.messages) {
        if (message.kind === "control") await drain(message.envelope);
        else for (const control of message.envelope.packet.controls) await drain({ version: 1, requestId: randomUUID(), deliveryId: message.envelope.deliveryId, launchDigest: message.envelope.launchDigest, control });
      }
      for (const id of candidates) {
        const attempt = this.journal.get(id)!;
        if (attempt.state === "intent") await this.launch(attempt);
      }
      // Outbox failure cannot starve cancellation polling. Reports stay ordered
      // and durable; receiving a control never depends on a source-report ack.
      try { await this.flush(); } catch (error) { failure ??= error; }
      if (failure) throw failure;
    } finally { this.ticking = false; }
  }
  private async launch(attempt: Attempt) {
    const delivery = attempt.delivery, { launch } = delivery.packet;
    if (Date.parse(launch.deadlineAt) <= Date.now()) { this.neverStarted(attempt, "Delivery deadline expired before launch", "timed_out"); return; }
    const availability = this.driver.availability(delivery);
    if (!availability.available) { this.neverStarted(attempt, availability.reason); return; }
    let workspace: Awaited<ReturnType<typeof prepareLockedLocalWorkspace>>;
    try {
      workspace = await prepareLockedLocalWorkspace(workspaceInput(this.root, this.config, attempt), { owner: this.owner(delivery), recordLock: lock => this.journal.recordLock(delivery.deliveryId, lock) });
    } catch {
      this.neverStarted(this.journal.get(delivery.deliveryId)!, "Workspace preparation failed; no process was launched"); return;
    }
    if (Date.parse(launch.deadlineAt) <= Date.now()) {
      this.neverStarted(this.journal.get(delivery.deliveryId)!, "Delivery deadline expired during workspace preparation", "timed_out"); return;
    }
    // This durable boundary MUST precede calling any function that could spawn.
    this.journal.transition(delivery.deliveryId, "spawn_possible");
    let handle: ProcessHandle;
    try { handle = this.driver.launch({ delivery, cwd: workspace.cwd, onText: text => this.source(delivery, text), onQuestion: question => this.sourceRecord(delivery, { type: "question", question }), model: async (key, input) => {
      if (!this.transport.model) throw new Error("Trusted kernel execution.model transport is unavailable");
      this.journal.modelRequest(delivery.deliveryId, key, input);
      // The app admits model traffic only after its durable started report.
      // Never race the first model request against the polling upload loop.
      await this.flush();
      const receipt = modelReceiptSchema.parse(await this.transport.model(delivery, key, input));
      this.journal.modelReceipt(delivery.deliveryId, key, receipt);
      return receipt;
    } }); }
    catch { this.journal.transition(delivery.deliveryId, "unknown"); return; }
    const active: Active = { process: handle, done: Promise.resolve(), release: workspace.release, cancelled: false, text: "", truncated: false, missing: false };
    this.active.set(delivery.deliveryId, active);
    try {
      this.journal.write(() => {
        this.journal.transition(delivery.deliveryId, "running", handle.identity);
        this.journal.enqueue(this.report(delivery, "started", handle.identity));
      });
    } catch (error) {
      handle.stop();
      active.done = handle.closed.then(() => {}).catch(() => {}).finally(() => { this.active.delete(delivery.deliveryId); });
      throw error;
    }
    active.done = handle.closed.then(result => {
      const current = this.journal.get(delivery.deliveryId)!;
      const expired = Date.parse(launch.deadlineAt) <= Date.now();
      const final = executionDeliveryFinalSchema.parse({ outcome: active.cancelled ? "cancelled" : expired ? "timed_out" : result.outcome ?? (result.code === 0 ? "finished" : "failed"), error: active.cancelled ? "Cancelled" : result.code === 0 ? null : result.error ?? "Supervised process exited unsuccessfully", throughSourceSeq: current.sourceWatermark, baseline: launch.workspace.baseline, finalMessage: active.text ? { messageId: `out:${executionDigest(delivery.deliveryId).slice(0, 40)}`, text: active.text, truncated: active.truncated } : null, missing: active.missing });
      this.finish(current, final, handle.identity);
      active.release();
    }).catch(() => {
      const current = this.journal.get(delivery.deliveryId)!;
      if (current.state === "spawn_possible" || current.state === "running") this.journal.transition(delivery.deliveryId, "unknown");
      // No stop proof, capacity release, worktree deletion or replay on uncertainty.
    }).finally(() => { this.active.delete(delivery.deliveryId); });
  }
  private sourceRecord(delivery: Delivery, payload: ExecutionPayload) {
    const active = this.active.get(delivery.deliveryId);
    if (!active || active.missing) throw new Error("Execution cannot accept source facts");
    try {
      const sequence = this.journal.get(delivery.deliveryId)!.sourceWatermark + 1;
      const records = [{ sequence, at: new Date().toISOString(), payload }];
      const report = this.report(delivery, "source", { records }, `source:${sequence}`);
      if (!this.journal.sourceWithinBudget(report)) {
        const gap = { sequence, at: records[0]!.at, payload: { type: "gap" as const, from: sequence, through: sequence, reason: "backpressure" as const } };
        this.journal.enqueue(this.report(delivery, "source", { records: [gap] }, `source:${sequence}`));
        throw new Error("Source receipt budget reached; durable gap recorded before stopping");
      }
      this.journal.enqueue(report);
    } catch (error) { active.missing = true; active.truncated = true; active.process.stop(); throw error; }
  }
  private source(delivery: Delivery, text: string) {
    const active = this.active.get(delivery.deliveryId);
    if (!active || active.missing) return;
    active.text += text;
    if (active.text.length > 24000) { active.text = textPrefix(active.text, 24000); active.truncated = true; }
    try {
      // Bound each record well below the app's 32KiB source limit.
      for (let offset = 0; offset < text.length;) {
        const delta = textPrefix(text.slice(offset), 2048); offset += delta.length;
        this.sourceRecord(delivery, { type: "text_delta", messageId: `out:${executionDigest(delivery.deliveryId).slice(0, 40)}`, delta });
      }
    } catch { active.missing = true; active.truncated = true; active.process.stop(); }
  }
  private async control(raw: unknown) {
    const envelope = controlEnvelopeSchema.parse(raw), attempt = this.journal.get(envelope.deliveryId);
    if (!attempt) return; // Missing journal is reconciled as unknown; never acknowledge a guessed target.
    if (attempt.delivery.launchDigest !== envelope.launchDigest) throw new Error("Control launch digest mismatch");
    const { control } = envelope, status = this.journal.control(envelope.deliveryId, control.requestKey, control);
    if (status === "applied") return;
    if (control.operation === "cleanup") {
      if (control.payload.workId !== attempt.delivery.packet.target.workId) throw new Error("Cleanup work fence mismatch");
      const receipt = await executeCleanup(this.root, this.config, this.journal, attempt, control.payload);
      const report = this.report(attempt.delivery, "cleanup", { controlKey: control.requestKey, report: { ...receipt, operationKey: control.requestKey } }, `cleanup:${appDigest([control.requestKey])}`);
      // Cleanup has its own native receipt, not a generic control-ack. Commit
      // the receipt outbox and local acknowledgement atomically after effect.
      this.journal.appliedControl(envelope.deliveryId, control.requestKey, report);
      return;
    }
    const active = this.active.get(envelope.deliveryId);
    if (status === "possible" && control.payload.operation !== "cancel") return; // uncertain writes/answers cannot replay
    if (control.payload.operation === "cancel") {
      if (attempt.state === "intent") this.neverStarted(attempt, "Cancelled before launch", "cancelled");
      else if (active) {
        active.cancelled = true; active.process.stop(); await active.done;
        if (this.journal.get(envelope.deliveryId)!.state !== "stopped") return;
      }
      else if (attempt.state !== "stopped") return;
    } else {
      if (!active) return; // A stopped/missing provider cannot receive write/answer effects.
      await active.process.write(JSON.stringify(control.payload));
    }
    const report = this.report(attempt.delivery, "control-ack", { controlKey: control.requestKey }, `ack:${appDigest([control.requestKey])}`);
    this.journal.appliedControl(envelope.deliveryId, control.requestKey, report);
  }
  async idle() { await Promise.all([...this.active.values()].map(active => active.done)); }
  /** Explicit local shutdown requests stop. Network failures never call this. */
  async close() {
    if (this.closed) return;
    for (const active of this.active.values()) { active.cancelled = true; active.process.stop(); }
    await this.idle();
    this.closed = true; this.journal.close(); this.lock.close();
  }
}
