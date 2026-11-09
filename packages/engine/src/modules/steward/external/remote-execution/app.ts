import { createPublicKey, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { bounded, canonical, check, digest, hashSecret, input, LIMITS, launchDigest, ProtocolError, readStored, validate, type ModelInput, type ModelResult, type Baseline, type Packet, type AppFence, type Caller, type Control, type Delivery, type DeviceFence, type KernelDeliveryPort, type KernelReceipt, type Receipt, type Report } from "./contracts";
import { initializeBudget, reserveDelivery, reserveReport, reserveControl } from "./budget";
import { Store, type DeliveryRow, type DeviceRow, type OutboxRow } from "./store";

type Binding = { version: 1; workspaceId: string; ownerId: string; app: AppFence };
type PairingCreate = { version: 1; requestKey: string; deviceId: string; incarnation: string; keyId: string; publicKey: string; expiresInMs: number };
type Pair = { version: 1; requestId: string; code: string; credential: string; publicKey: string };
type Auth = { version: 1; requestId: string; credential: string; device: DeviceFence };
type Mapping = { version: 1; requestKey: string; projectRef: string; device: DeviceFence; workspaceRef: string; baseline: Baseline; directoryIdentity: string; workspaceModes: string[]; expectedRevision: number };
type MappingRow = { project_ref: string; revision: number; device_id: string; generation: number; incarnation: string; key_id: string; workspace_ref: string; baseline: string; directory_identity: string; workspace_modes: string };
type SnapshotItem = { deliveryId: string; launchDigest: string; state: string; journalSeq: number; sourceWatermark: number };
type Reconcile = Auth & { snapshotId: string; page: number; complete: boolean; items: SnapshotItem[] };
const key = (kind: string, ...parts: unknown[]) => `${kind}:${digest(parts)}`;
const deviceFence = (row: DeviceRow): DeviceFence => ({ deviceId: row.device_id, generation: row.generation, incarnation: row.incarnation, keyId: row.key_id });

/** Ordinary application relay. The kernel alone admits Runs, charges budgets and verifies stop evidence. */
export class RemoteExecutionApp {
  private binding: Binding | null = null;
  private serial: Promise<unknown> = Promise.resolve();
  private forwarding: Promise<unknown> | null = null;
  constructor(readonly store: Store, readonly kernel: KernelDeliveryPort, readonly now: () => number = Date.now) { initializeBudget(store); }
  handle(tool: string, args: Record<string, unknown>, caller: Caller): Promise<unknown> {
    if (tool === "forward" || tool === "sync") {
      check(caller.kind === "kernel", "forbidden"); input("flush", args); check(this.binding, "unbound");
      if (tool === "sync") return this.synchronize();
      if (!this.forwarding) this.forwarding = this.forward().finally(() => { this.forwarding = null; });
      return this.forwarding;
    }
    if (tool === "device-model") {
      check(caller.kind === "kernel", "forbidden");
      const request = input<Auth & { deliveryId: string; launchDigest: string; key: string; input: ModelInput }>("device-model", args);
      const prepared = this.serial.then(() => this.prepareModel(request));
      this.serial = prepared.catch(() => {});
      return prepared.then(async messageKey => {
        await this.handle("forward", { input: '{"version":1}' }, { kind: "kernel" });
        this.authenticate(request);
        const row = this.store.db.query<{ response: string }, [string]>("SELECT response FROM model_observations WHERE message_key=?").get(messageKey);
        check(row, "unavailable", "Awaiting the kernel's fixed model receipt; retry only this same key");
        return readStored<ModelResult>("model-result", row.response);
      });
    }
    const result = this.serial.then(() => this.dispatch(tool, args, caller));
    this.serial = result.catch(() => {}); return result;
  }
  private async dispatch(tool: string, args: Record<string, unknown>, caller: Caller): Promise<unknown> {
    const ownerTools = ["pairing-create", "mapping-set", "device-revoke", "status"];
    const kernelTools = ["bind", "delivery", "control", "device-pair", "device-poll", "device-report", "device-reconcile", "lifecycle", "forward"];
    if (ownerTools.includes(tool)) check(caller.kind === "owner", "forbidden");
    else if (kernelTools.includes(tool)) check(caller.kind === "kernel", "forbidden");
    else if (tool === "placement") check(caller.kind === "module" || caller.kind === "owner", "forbidden");
    else throw new ProtocolError("unknown_tool");
    if (tool === "bind") {
      const binding = input<Binding>("bind", args);
      check(this.binding === null || canonical(this.binding) === canonical(binding), "conflict");
      // Actual module identity/activation and owner authorization must be supplied by the real kernel route.
      const previous = this.store.db.query<{ value: string }, []>("SELECT value FROM meta WHERE key='binding'").get();
      if (previous) {
        const old = readStored<Binding>("bind", previous.value);
        check(old.workspaceId === binding.workspaceId && old.ownerId === binding.ownerId && old.app.moduleId === binding.app.moduleId && (old.app.hash === binding.app.hash || old.app.activationId !== binding.app.activationId), "fence_mismatch");
      }
      this.store.write("bind", () => {
        if (previous) {
          const old = readStored<Binding>("bind", previous.value);
          if (old.app.activationId !== binding.app.activationId) {
            // Only an authenticated host may bind the new activation. The kernel
            // rotates it after its idle guard; retained old deliveries never relaunch.
            this.store.db.exec("UPDATE meta SET value='0' WHERE key='fenced'; UPDATE devices SET ready=0; UPDATE delivery_status SET launchable=0");
          }
        }
        this.store.db.query("INSERT INTO meta VALUES ('binding',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(canonical(binding));
      }, "$control");
      this.binding = binding; return { version: 1, state: "bound", reconciliationRequired: true };
    }
    check(this.binding, "unbound");
    switch (tool) {
      case "pairing-create": return this.createPairing(input("pairing-create", args));
      case "device-pair": return this.pair(input("device-pair", args));
      case "mapping-set": return this.map(input("mapping-set", args));
      case "device-revoke": return this.revoke(input("device-revoke", args));
      case "placement": return this.placement(input("placement", args));
      case "delivery": return this.accept(input("delivery", args));
      case "control": return this.control(input("control", args));
      case "device-poll": return this.poll(input("device-poll", args));
      case "device-report": return this.report(input("device-report", args));
      case "device-reconcile": return this.reconcile(input("device-reconcile", args));
      case "lifecycle": return this.lifecycle(input("lifecycle", args));
      case "forward": input("flush", args); return this.forward();
      case "status": input("status", args); return this.status();
    }
  }
  /** Authenticate before a device request can cause a routed poll/allocation.
   * The handler authenticates again after IO because revocation may race it. */
  authorizeDevice(tool: "device-poll" | "device-reconcile", args: Record<string, unknown>) {
    check(this.binding, "unbound"); this.authenticate(input<Auth>(tool, args));
  }
  private receipt(requestId: string, requestDigest: string, state: string): Receipt {
    return { version: 1, requestId, requestDigest, receiptId: randomUUID(), committedAt: new Date(this.now()).toISOString(), state };
  }
  private open() { check(!this.store.fenced(), "lifecycle_fenced"); }
  private current(device: DeviceFence): DeviceRow {
    const row = this.store.device(device.deviceId, device.generation);
    check(row && row.incarnation === device.incarnation && row.key_id === device.keyId, "fence_mismatch"); return row;
  }
  private authenticate(auth: Auth): DeviceRow {
    const row = this.current(auth.device), actual = Buffer.from(hashSecret(auth.credential), "hex"), expected = Buffer.from(row.credential_hash, "hex");
    check(actual.length === expected.length && timingSafeEqual(actual, expected), "unauthorized"); return row;
  }
  private createPairing(request: PairingCreate) {
    try { check(createPublicKey(request.publicKey).asymmetricKeyType === "ed25519", "invalid"); }
    catch { throw new ProtocolError("invalid", "Pairing requires an Ed25519 PEM public key"); }
    const requestDigest = digest(request);
    return this.store.write("pairing-create", () => {
      const original = this.store.original("pairing-create", request.requestKey, requestDigest); if (original) return original;
      this.open();
      check(!this.store.db.query("SELECT 1 FROM devices WHERE device_id=? AND state!='revoked'").get(request.deviceId), "device_active");
      const next = this.store.db.query<{ generation: number }, [string, string]>("SELECT COALESCE(MAX(generation),0)+1 AS generation FROM (SELECT generation FROM devices WHERE device_id=? UNION ALL SELECT generation FROM pairings WHERE device_id=?)").get(request.deviceId, request.deviceId)!.generation;
      const code = randomBytes(32).toString("base64url"), expiresAt = this.now() + request.expiresInMs;
      this.store.db.query("INSERT INTO pairings(code_hash,device_id,generation,incarnation,key_id,public_key,expires_at) VALUES (?,?,?,?,?,?,?)").run(hashSecret(code), request.deviceId, next, request.incarnation, request.keyId, request.publicKey, expiresAt);
      return this.store.receipt("pairing-create", request.requestKey, requestDigest, { ...this.receipt(request.requestKey, requestDigest, "pairing-pending"), code, expiresAt: new Date(expiresAt).toISOString(), device: { deviceId: request.deviceId, generation: next, incarnation: request.incarnation, keyId: request.keyId } });
    });
  }
  private pair(request: Pair) {
    // The bearer itself is never persisted, including in receipts or inbox envelopes.
    const material = { version: 1, codeHash: hashSecret(request.code), credentialHash: hashSecret(request.credential), publicKey: request.publicKey }, requestDigest = digest(material);
    return this.store.write("device-pair", () => {
      const row = this.store.db.query<{ device_id: string; generation: number; incarnation: string; key_id: string; public_key: string; expires_at: number; consumed_digest: string | null; consumed_receipt: string | null; consumed_at: number | null }, [string]>("SELECT * FROM pairings WHERE code_hash=?").get(material.codeHash);
      check(row, "unauthorized");
      if (row.consumed_digest) {
        check(row.consumed_digest === requestDigest, "conflict"); check(this.now() - row.consumed_at! <= 86_400_000, "expired");
        return JSON.parse(row.consumed_receipt!);
      }
      const original = this.store.original("device-pair", request.requestId, requestDigest); if (original) return original;
      this.open(); check(row.expires_at > this.now(), "expired"); check(row.public_key === request.publicKey, "fence_mismatch");
      check(!this.store.db.query("SELECT 1 FROM devices WHERE device_id=? AND state!='revoked'").get(row.device_id), "device_active");
      const newest = this.store.db.query<{ n: number }, [string]>("SELECT MAX(generation) AS n FROM pairings WHERE device_id=?").get(row.device_id)!.n;
      check(newest === row.generation, "stale_generation");
      this.store.physical.reserve(`device:${row.device_id}:${row.generation}`, 64);
      this.store.db.query("INSERT INTO devices VALUES (?,?,?,?,?,?,'active',0,NULL)").run(row.device_id, row.generation, row.incarnation, row.key_id, row.public_key, material.credentialHash);
      const value = { ...this.receipt(request.requestId, requestDigest, "paired-reconciliation-required"), device: { deviceId: row.device_id, generation: row.generation, incarnation: row.incarnation, keyId: row.key_id } };
      this.store.db.query("UPDATE pairings SET consumed_digest=?,consumed_receipt=?,consumed_at=? WHERE code_hash=?").run(requestDigest, canonical(value), this.now(), material.codeHash);
      return this.store.receipt("device-pair", request.requestId, requestDigest, value, material);
    });
  }
  private map(request: Mapping) {
    const requestDigest = digest(request);
    return this.store.write("mapping-set", () => {
      const original = this.store.original("mapping-set", request.requestKey, requestDigest); if (original) return original;
      this.open(); check(this.current(request.device).state === "active", "revoked");
      const prior = this.mapping(request.projectRef); check((prior?.revision ?? 0) === request.expectedRevision, "conflict");
      const revision = request.expectedRevision + 1;
      this.store.db.query("INSERT INTO mappings VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_ref) DO UPDATE SET revision=excluded.revision,device_id=excluded.device_id,generation=excluded.generation,incarnation=excluded.incarnation,key_id=excluded.key_id,workspace_ref=excluded.workspace_ref,baseline=excluded.baseline,directory_identity=excluded.directory_identity,workspace_modes=excluded.workspace_modes").run(request.projectRef, revision, request.device.deviceId, request.device.generation, request.device.incarnation, request.device.keyId, request.workspaceRef, canonical(request.baseline), request.directoryIdentity, canonical(request.workspaceModes));
      return this.store.receipt("mapping-set", request.requestKey, requestDigest, { ...this.receipt(request.requestKey, requestDigest, "mapped"), mappingRevision: revision });
    });
  }
  private mapping(projectRef: string) { return this.store.db.query<MappingRow, [string]>("SELECT * FROM mappings WHERE project_ref=?").get(projectRef); }
  private placement(request: { projectRef: string }) {
    this.open(); const mapping = this.mapping(request.projectRef); check(mapping, "unmapped");
    const device = this.store.device(mapping.device_id, mapping.generation)!; check(device.state === "active" && device.ready === 1, "reconciliation_required");
    return { version: 1, kind: "remote-placement", projectRef: request.projectRef, mappingRevision: mapping.revision, device: deviceFence(device), workspaceRef: mapping.workspace_ref, baseline: JSON.parse(mapping.baseline), directoryIdentity: mapping.directory_identity, workspaceModes: JSON.parse(mapping.workspace_modes), app: this.binding!.app, placement: { kind: "application", applicationId: this.binding!.app.moduleId, targetRef: mapping.project_ref, targetRevision: mapping.revision, projectRef: mapping.project_ref }, authorization: "requires-kernel-admission" };
  }
  /** Kernel poll is a durable offer, not a second scheduling queue. */
  private async synchronize() {
    check(this.binding, "unbound");
    const raw = await this.kernel.poll(); validate("kernel-poll", raw); bounded(raw, LIMITS.body);
    let received = 0;
    for (const packet of (raw as { deliveries: Packet[] }).deliveries) {
      await this.serializedPacket(packet); received++;
    }
    this.store.write("kernel-observed", () => this.store.db.query("INSERT INTO meta VALUES ('kernel-observed',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(this.store.bootId), "$control");
    return { version: 1, state: "synchronized", received };
  }
  private serializedPacket(packet: Packet) {
    const task = this.serial.then(() => {
      const request: Delivery = { version: 1, requestId: key("offer", packet.target.deliveryId), deliveryId: packet.target.deliveryId, launchDigest: packet.target.launchDigest, packet };
      return this.accept(request);
    });
    this.serial = task.catch(() => {}); return task;
  }
  private accept(request: Delivery) {
    const { target, launch } = request.packet;
    bounded(launch, LIMITS.launch);
    check(target.deliveryId === request.deliveryId && target.launchDigest === request.launchDigest && launchDigest(launch) === request.launchDigest, "digest_mismatch");
    const { launchDigest: _digest, ...fence } = target;
    check(canonical(fence) === canonical(launch.fence), "fence_mismatch");
    check(fence.workspaceId === this.binding!.workspaceId && fence.ownerId === this.binding!.ownerId && fence.receiverModuleId === this.binding!.app.moduleId && fence.receiverHash === this.binding!.app.hash && fence.receiverActivationId === this.binding!.app.activationId, "fence_mismatch");
    // Mutable poll flags and controls are not part of the immutable launch identity.
    const requestDigest = digest({ target, launch });
    return this.store.write("delivery", () => {
      const original = this.store.original("delivery", request.deliveryId, requestDigest);
      const previous = this.store.delivery(request.deliveryId);
      if (original) {
        this.store.db.query("UPDATE delivery_status SET launchable=MIN(launchable,?),boot_id=? WHERE delivery_id=?").run(request.packet.launchable ? 1 : 0, this.store.bootId, request.deliveryId);
        if (!this.store.db.query("SELECT 1 FROM outbox WHERE channel='device' AND kind='launch' AND delivery_id=?").get(request.deliveryId)) {
          const saved = previous!;
          this.store.enqueue("device", key("launch", request.deliveryId), request.deliveryId, { deviceId: saved.device_id, generation: saved.generation, incarnation: saved.incarnation }, "launch", { ...request, packet: { ...request.packet, controls: [] } });
        }
        for (const control of request.packet.controls) this.control({ version: 1, requestId: key("control", request.deliveryId, control.requestKey), deliveryId: request.deliveryId, launchDigest: request.launchDigest, control });
        return original;
      }
      check(!previous, "conflict"); this.open();
      const device = this.store.device(fence.subjectId, fence.epoch);
      check(device && device.key_id === fence.keyId, "fence_mismatch");
      check(device.state === "active", "revoked");
      const mapping = this.mapping(launch.target.projectRef);
      check(mapping && mapping.revision === launch.target.targetRevision && mapping.project_ref === launch.placement.projectRef && launch.placement.targetRevision === mapping.revision && launch.placement.applicationId === this.binding!.app.moduleId && launch.placement.targetRef === launch.target.targetRef && mapping.device_id === device.device_id && mapping.generation === device.generation && mapping.incarnation === device.incarnation && mapping.key_id === device.key_id && mapping.baseline === canonical(launch.target.baseline) && mapping.baseline === canonical(launch.workspace.baseline) && mapping.directory_identity === launch.target.directoryIdentity && mapping.workspace_modes === canonical(launch.target.workspaceModes) && launch.target.workspaceModes.includes(launch.workspace.mode), "fence_mismatch");
      check(Number.isFinite(Date.parse(launch.deadlineAt)), "invalid");
      reserveDelivery(this.store, request.deliveryId, device.device_id, device.generation);
      reserveReport(this.store, request.deliveryId, Buffer.byteLength(canonical(request)), "ordinary");
      this.store.db.query("INSERT INTO deliveries VALUES (?,?,?,?,?,?)").run(request.deliveryId, request.launchDigest, device.device_id, device.generation, device.incarnation, canonical(request));
      this.store.db.query("INSERT INTO delivery_status VALUES (?,?,?)").run(request.deliveryId, request.packet.launchable ? 1 : 0, this.store.bootId);
      // Kernel workspaceRef identifies its attempt; this local alias identifies the
      // owner's device workspace and must survive later mapping revisions.
      this.store.db.query("INSERT INTO delivery_workspaces VALUES (?,?,?)").run(request.deliveryId, mapping.workspace_ref, mapping.revision);
      // Retain the immutable identity even for a cancelled cold claim. A
      // drain-only offer can establish its journal and signed never-started
      // evidence; its mutable launchable flag must never authorize a process.
      this.store.enqueue("device", key("launch", request.deliveryId), request.deliveryId, deviceFence(device), "launch", { ...request, packet: { ...request.packet, controls: [] } });
      if (request.packet.launchable) {
        this.store.enqueueKernel("accept", key("accept", request.deliveryId), deviceFence(device), request as unknown as Record<string, unknown>, request.deliveryId);
      }
      for (const control of request.packet.controls) this.control({ version: 1, requestId: key("control", request.deliveryId, control.requestKey), deliveryId: request.deliveryId, launchDigest: request.launchDigest, control });
      return this.store.receipt("delivery", request.deliveryId, requestDigest, this.receipt(request.requestId, requestDigest, "durably-accepted"), request);
    });
  }
  private control(request: Control) {
    bounded(request.control, LIMITS.source);
    const requestDigest = digest({ deliveryId: request.deliveryId, launchDigest: request.launchDigest, control: request.control });
    return this.store.write("control", () => {
      const scope = key("control", request.deliveryId), controlKey = request.control.requestKey;
      const original = this.store.original(scope, controlKey, requestDigest); if (original) return original;
      const row = this.store.delivery(request.deliveryId); check(row && row.launch_digest === request.launchDigest, "fence_mismatch");
      reserveControl(this.store, row.delivery_id, Buffer.byteLength(canonical(request)), (request.control.operation === "control" && request.control.payload.operation === "cancel"));
      this.store.enqueue("device", key("control", row.delivery_id, controlKey), row.delivery_id, { deviceId: row.device_id, generation: row.generation, incarnation: row.incarnation }, "control", request);
      if ((request.control.operation === "control" && request.control.payload.operation === "cancel")) this.store.db.query("UPDATE delivery_status SET launchable=0 WHERE delivery_id=?").run(row.delivery_id);
      return this.store.receipt(scope, controlKey, requestDigest, this.receipt(request.requestId, requestDigest, "control-pending"), request);
    }, request.control.operation === "control" && request.control.payload.operation === "cancel" ? `delivery:${request.deliveryId}` : undefined);
  }
  private poll(request: Auth) {
    const device = this.authenticate(request);
    return this.store.write("poll", () => {
      const rows = this.store.db.query<OutboxRow, [string, number, string, number, string, string]>(`SELECT * FROM (SELECT o.*,ROW_NUMBER() OVER (PARTITION BY kind ORDER BY attempts,id) AS visit_rank FROM outbox o WHERE channel='device' AND device_id=? AND generation=? AND incarnation=? AND acknowledged=0
        AND (kind='control' OR (?=1 AND NOT EXISTS (SELECT 1 FROM quarantined q WHERE q.delivery_id=o.delivery_id) AND (
          (EXISTS (SELECT 1 FROM delivery_status s WHERE s.delivery_id=o.delivery_id AND s.launchable=1 AND s.boot_id=?)
            AND EXISTS (SELECT 1 FROM outbox a WHERE a.channel='kernel' AND a.kind='accept' AND a.delivery_id=o.delivery_id AND a.acknowledged=1)
            AND julianday(json_extract(o.envelope,'$.packet.launch.deadlineAt'))>julianday(?))
          OR (o.offered=0 AND EXISTS (SELECT 1 FROM outbox c WHERE c.channel='device' AND c.delivery_id=o.delivery_id AND c.kind='control' AND c.acknowledged=0
                AND json_extract(c.envelope,'$.control.operation')='control' AND json_extract(c.envelope,'$.control.payload.operation')='cancel')
            AND NOT EXISTS (SELECT 1 FROM outbox r WHERE r.channel='kernel' AND r.delivery_id=o.delivery_id AND r.kind='report' AND json_extract(r.envelope,'$.payload.kind') IN ('final','stop')))
        )))
        ) WHERE visit_rank<=CASE kind WHEN 'control' THEN 90 ELSE 10 END
        ORDER BY CASE kind WHEN 'control' THEN 0 ELSE 1 END,attempts,id`).all(device.device_id, device.generation, device.incarnation, !this.store.fenced() && device.state === "active" && device.ready === 1 ? 1 : 0, this.store.bootId, new Date(this.now()).toISOString());
      const messages: { messageKey: string; kind: string; localWorkspaceRef: string; envelope: Delivery | Control }[] = [];
      const prepared = rows.map(row => {
        const drainOnly = row.kind === "launch" && !!this.store.db.query("SELECT 1 FROM delivery_status WHERE delivery_id=? AND launchable=0").get(row.delivery_id!);
        let envelope = row.kind === "launch" ? readStored<Delivery>("delivery", row.envelope) : readStored<Control>("control", row.envelope);
        if (drainOnly) {
          const delivery = envelope as Delivery;
          const cancellation = this.store.db.query<OutboxRow, [string]>("SELECT * FROM outbox WHERE channel='device' AND delivery_id=? AND kind='control' AND acknowledged=0 AND json_extract(envelope,'$.control.operation')='control' AND json_extract(envelope,'$.control.payload.operation')='cancel' ORDER BY attempts,id LIMIT 1").get(row.delivery_id!)!;
          const control = readStored<Control>("control", cancellation.envelope).control;
          envelope = { ...delivery, packet: { ...delivery.packet, launchable: false, controls: [control] } };
        }
        const local = this.store.db.query<{ workspace_ref: string }, [string]>("SELECT workspace_ref FROM delivery_workspaces WHERE delivery_id=?").get(row.delivery_id!);
        check(local, "fence_mismatch");
        const item = { messageKey: row.message_key, kind: row.kind, localWorkspaceRef: local.workspace_ref, envelope };
        return { row, item, drainOnly };
      });
      // Reserve the complete wire item, including long identity fields and an
      // embedded cancellation, rather than estimating from the launch alone.
      let launchReserve = Math.max(0, ...prepared.filter(({ row }) => row.kind === "launch").map(({ item }) => Buffer.byteLength(canonical(item)) + 1));
      for (const { row, item, drainOnly } of prepared) {
        if (Buffer.byteLength(canonical([...messages, item])) > LIMITS.batch - (row.kind === "control" ? launchReserve : 0)) continue;
        if (row.kind === "launch") launchReserve = 0;
        // The durable visit count rotates unacknowledged rows, including after a
        // lost response or app restart. Only rows actually included are visited.
        // offered records a possible launch authorization. Drain-only identity
        // replay never crosses that boundary, so a lost reply can be retried
        // without turning its absent journal into an unknown running process.
        this.store.db.query("UPDATE outbox SET offered=MAX(offered,?),attempts=attempts+1 WHERE id=?").run(drainOnly ? 0 : 1, row.id); messages.push(item);
      }
      return { version: 1, state: "offered", reconciliationRequired: device.ready !== 1, messages };
    }, "$control");
  }
  private report(request: Auth & { report: Report }) {
    const device = this.authenticate(request), report = request.report;
    const row = this.store.delivery(report.deliveryId);
    check(row && row.device_id === device.device_id && row.generation === device.generation && row.incarnation === device.incarnation && row.launch_digest === report.launchDigest, "fence_mismatch");
    const maximum = report.kind === "final" ? LIMITS.final : report.kind === "source" ? LIMITS.batch : LIMITS.proof;
    bounded(report.payload, maximum);
    const fixedKey = report.kind === "source" ? `source:${(report.payload.records as { sequence: number }[])[0]!.sequence}` : report.kind === "stop" ? `stop:${digest(report.payload)}` : report.kind === "cleanup" ? key("cleanup", report.payload.controlKey) : report.kind === "control-ack" ? key("ack", report.payload.controlKey) : report.kind;
    check(report.reportKey === fixedKey, "invalid", "Use the fixed business report key from protocol.schema.json");
    const { requestId: _transport, reportKey: _key, ...business } = report;
    const reportDigest = digest(business), scope = key("report", report.deliveryId);
    return this.store.write("report", () => {
      const original = this.store.original(scope, report.reportKey, reportDigest); if (original) return original;
      if (device.state !== "active" || this.store.fenced()) {
        const sourceDrain = report.kind === "source" && !this.store.db.query("SELECT 1 FROM outbox WHERE channel='kernel' AND delivery_id=? AND kind='report' AND json_extract(envelope,'$.payload.kind')='final'").get(row.delivery_id);
        check(sourceDrain || ["final", "stop", "control-ack", "cleanup"].includes(report.kind), "revoked");
      }
      if (report.kind === "source") {
        check(!this.finalQueued(row.delivery_id), "conflict", "A fixed final closes the source frontier");
        const sources = this.store.db.query<{ envelope: string }, [string]>("SELECT envelope FROM inbox WHERE scope=?").all(scope).map(item => readStored<Report>("report", item.envelope)).filter(item => item.kind === "source");
        let through = Math.max(0, ...sources.flatMap(item => (item.payload.records as { sequence: number }[]).map(record => record.sequence)));
        for (const record of report.payload.records as { sequence: number; at: string; payload: unknown }[]) {
          bounded(record, LIMITS.source); check(Number.isFinite(Date.parse(record.at)), "invalid");
          check(record.sequence === ++through, "conflict", "Source sequence must be contiguous; missing detail uses a gap event");
        }
      }
      if (report.kind === "stop") {
        const delivery = readStored<Delivery>("delivery", row.envelope);
        check(canonical((report.payload.statement as { target: unknown }).target) === canonical(delivery.packet.target), "fence_mismatch");
      }
      let cancellationAck = false;
      if (report.kind === "control-ack" || report.kind === "cleanup") {
        const controls = this.store.db.query<{ envelope: string }, [string]>("SELECT envelope FROM outbox WHERE channel='device' AND kind='control' AND delivery_id=?").all(report.deliveryId).map(item => readStored<Control>("control", item.envelope));
        const control = controls.find(control => control.control.requestKey === report.payload.controlKey);
        check(control && (report.kind !== "cleanup" || control.control.operation === "cleanup"), "fence_mismatch");
        cancellationAck = control.control.operation === "control" && control.control.payload.operation === "cancel";
        if (report.kind === "cleanup") {
          const delivery = readStored<Delivery>("delivery", row.envelope), receipt = report.payload.report as Record<string, unknown>;
          check(receipt.operationKey === report.payload.controlKey && receipt.workId === delivery.packet.target.workId && receipt.workspaceRef === delivery.packet.launch.workspaceRef, "fence_mismatch");
        }
      }
      // Any durable process/terminal evidence closes the launch relay. Even an
      // unverified stop may indicate spawn was possible; it never authorizes retry.
      if (["started", "final", "stop"].includes(report.kind)) this.store.db.query("UPDATE delivery_status SET launchable=0 WHERE delivery_id=?").run(report.deliveryId);
      const budgetKind = report.kind === "source" ? ((report.payload.records as { payload: { type: string } }[]).every(record => record.payload.type === "gap") ? "gap" : "source") : report.kind === "started" || report.kind === "cleanup" ? "ordinary" : report.kind === "control-ack" && !cancellationAck ? "ordinary-ack" : report.kind;
      reserveReport(this.store, report.deliveryId, Buffer.byteLength(canonical(report)), budgetKind);
      this.store.enqueueKernel("report", key("report", report.deliveryId, report.reportKey), request.device, report as unknown as Record<string, unknown>, report.deliveryId);
      return this.store.receipt(scope, report.reportKey, reportDigest, this.receipt(report.requestId, reportDigest, "durably-received-evidence-unverified"), report);
    }, `delivery:${report.deliveryId}`);
  }

  private finalQueued(deliveryId: string) {
    return this.store.db.query("SELECT 1 FROM outbox WHERE channel='kernel' AND delivery_id=? AND kind='report' AND json_extract(envelope,'$.payload.kind')='final'").get(deliveryId) !== null;
  }
  private prepareModel(request: Auth & { deliveryId: string; launchDigest: string; key: string; input: ModelInput }) {
    const device = this.authenticate(request), row = this.store.delivery(request.deliveryId);
    check(row && row.device_id === device.device_id && row.generation === device.generation && row.incarnation === device.incarnation && row.launch_digest === request.launchDigest, "fence_mismatch");
    const messageKey = key("model", request.deliveryId, request.key);
    const payload = { version: 1, device: request.device, deliveryId: request.deliveryId, launchDigest: request.launchDigest, key: request.key, input: request.input };
    const requestDigest = digest(payload);
    this.store.write("model", () => {
      const old = this.store.db.query<{ request_digest: string }, [string]>("SELECT request_digest FROM model_inputs WHERE message_key=?").get(messageKey);
      if (old) { check(old.request_digest === requestDigest, "conflict"); return; }
      this.open(); check(device.state === "active", "revoked");
      check(!this.finalQueued(row.delivery_id), "conflict", "A fixed final closes new model requests");
      check(this.store.db.query("SELECT 1 FROM outbox WHERE channel='kernel' AND delivery_id=? AND kind='report' AND json_extract(envelope,'$.payload.kind')='started'").get(row.delivery_id), "conflict", "Model forwarding requires a durable started report");
      reserveReport(this.store, row.delivery_id, Buffer.byteLength(canonical(payload)), "ordinary");
      this.store.physical.reserve(`model:${messageKey}`, 512);
      this.store.db.query("INSERT INTO model_inputs VALUES (?,?)").run(messageKey, requestDigest);
      this.store.enqueueKernel("model", messageKey, request.device, payload, row.delivery_id);
    });
    return messageKey;
  }
  private recordModel(request: import("./contracts").KernelRequest, result: ModelResult) {
    validate("model-result", result); bounded(result, LIMITS.body);
    this.store.write("model-result", () => {
      const old = this.store.db.query<{ response: string }, [string]>("SELECT response FROM model_observations WHERE message_key=?").get(request.key);
      if (old) {
        const prior = readStored<ModelResult>("model-result", old.response);
        check(prior.reservationId === result.reservationId && (prior.status === "pending" || canonical(prior) === canonical(result)), "kernel_receipt_mismatch");
      }
      this.store.db.query("INSERT INTO model_observations VALUES (?,?) ON CONFLICT(message_key) DO UPDATE SET response=excluded.response").run(request.key, canonical(result));
    }, `model:${request.key}`);
  }
  private revoke(request: { version: 1; requestKey: string; deviceId: string; generation: number }) {
    const requestDigest = digest(request);
    return this.store.write("revoke", () => {
      const original = this.store.original("revoke", request.requestKey, requestDigest); if (original) return original;
      const device = this.store.device(request.deviceId, request.generation); check(device, "unknown_device");
      // Local blocking is immediate; revocation is complete only after the kernel's durable fence receipt.
      this.store.db.query("UPDATE devices SET state='revoking',ready=0 WHERE device_id=? AND generation=? AND state='active'").run(request.deviceId, request.generation);
      this.store.enqueueKernel("revoke", key("revoke", request.deviceId, request.generation), deviceFence(device), { ...request, device: deviceFence(device) }, null);
      this.cancelRequests(device, "revoked");
      return this.store.receipt("revoke", request.requestKey, requestDigest, this.receipt(request.requestKey, requestDigest, "kernel-revocation-pending"));
    }, this.store.device(request.deviceId, request.generation)?.state === "active" ? `device:${request.deviceId}:${request.generation}` : undefined);
  }
  private cancelRequests(device: DeviceRow, reason: "revoked" | "lifecycle") {
    for (const row of this.store.db.query<DeliveryRow, [string, number]>("SELECT * FROM deliveries WHERE device_id=? AND generation=?").all(device.device_id, device.generation)) {
      const delivery = readStored<Delivery>("delivery", row.envelope), messageKey = key("cancel", row.delivery_id, reason);
      this.store.write("cancel-request", () => this.store.enqueueKernel("cancel", messageKey, deviceFence(device), { version: 1, requestId: messageKey, deliveryId: row.delivery_id, launchDigest: row.launch_digest, target: delivery.packet.target, reason }, row.delivery_id), `delivery:${row.delivery_id}`);
    }
  }
  private lifecycle(request: { version: 1; requestKey: string; action: string }) {
    const requestDigest = digest(request);
    return this.store.write("lifecycle", () => {
      const original = this.store.original("lifecycle", request.requestKey, requestDigest); if (original) return original;
      this.store.fence();
      for (const device of this.store.db.query<DeviceRow, []>("SELECT * FROM devices").all()) this.cancelRequests(device, "lifecycle");
      return this.store.receipt("lifecycle", request.requestKey, requestDigest, { ...this.receipt(request.requestKey, requestDigest, "lifecycle-pending-kernel-settlement"), retained: true, mayDeleteData: false });
    }, this.store.fenced() ? undefined : "$control");
  }
  private reconcile(request: Reconcile) {
    const device = this.authenticate(request); bounded(request.items, LIMITS.batch);
    const sanitized = { version: 1, requestId: request.requestId, device: request.device, snapshotId: request.snapshotId, page: request.page, complete: request.complete, items: request.items }, requestDigest = digest(sanitized), scope = key("reconcile", request.device, request.snapshotId);
    return this.store.write("reconcile", () => {
      const original = this.store.original(scope, String(request.page), requestDigest); if (original) return original;
      const snapshot = this.store.db.query<{ boot_id: string; next_page: number; complete: number }, [string, number, string, string]>("SELECT * FROM snapshots WHERE device_id=? AND generation=? AND incarnation=? AND snapshot_id=?").get(device.device_id, device.generation, device.incarnation, request.snapshotId);
      check(!snapshot || (snapshot.boot_id === this.store.bootId && snapshot.complete === 0), "stale_snapshot");
      check((snapshot?.next_page ?? 0) === request.page, "page_order");
      if (!snapshot) this.store.db.query("INSERT INTO snapshots VALUES (?,?,?,?,?,0,0)").run(device.device_id, device.generation, device.incarnation, request.snapshotId, this.store.bootId);
      this.store.db.query("UPDATE devices SET ready=0,snapshot_id=? WHERE device_id=? AND generation=?").run(request.snapshotId, device.device_id, device.generation);
      const seen = new Set<string>();
      for (const item of request.items) {
        check(!seen.has(item.deliveryId), "conflict"); seen.add(item.deliveryId);
        const local = this.store.delivery(item.deliveryId);
        check(!local || (local.device_id === device.device_id && local.generation === device.generation && local.incarnation === device.incarnation && local.launch_digest === item.launchDigest), "fence_mismatch");
        check(!this.store.db.query("SELECT 1 FROM snapshot_items WHERE device_id=? AND generation=? AND incarnation=? AND snapshot_id=? AND delivery_id=?").get(device.device_id, device.generation, device.incarnation, request.snapshotId, item.deliveryId), "conflict");
        this.store.db.query("INSERT INTO snapshot_items VALUES (?,?,?,?,?,?)").run(device.device_id, device.generation, device.incarnation, request.snapshotId, item.deliveryId, canonical(item));
      }
      this.store.db.query("UPDATE snapshots SET next_page=?,complete=? WHERE device_id=? AND generation=? AND incarnation=? AND snapshot_id=?").run(request.page + 1, request.complete ? 1 : 0, device.device_id, device.generation, device.incarnation, request.snapshotId);
      const items = this.store.db.query<{ envelope: string }, [string, number, string, string]>("SELECT envelope FROM snapshot_items WHERE device_id=? AND generation=? AND incarnation=? AND snapshot_id=? ORDER BY delivery_id").all(device.device_id, device.generation, device.incarnation, request.snapshotId).map(row => readStored<SnapshotItem>("snapshot-item", row.envelope));
      const local = this.store.db.query<DeliveryRow, [string, number, string]>("SELECT * FROM deliveries WHERE device_id=? AND generation=? AND incarnation=?").all(device.device_id, device.generation, device.incarnation);
      const missing = local.filter(row => !items.some(item => item.deliveryId === row.delivery_id) && this.store.db.query("SELECT 1 FROM outbox WHERE channel='device' AND kind='launch' AND delivery_id=? AND offered=1").get(row.delivery_id)).map(row => row.delivery_id);
      for (const item of items) if (item.state !== "intent") this.store.db.query("UPDATE delivery_status SET launchable=0 WHERE delivery_id=?").run(item.deliveryId);
      check(items.length <= 100, "capacity");
      if (request.complete) for (const deliveryId of missing) this.store.db.query("INSERT INTO quarantined VALUES (?,?) ON CONFLICT(delivery_id) DO NOTHING").run(deliveryId, request.snapshotId);
      const page = { ...sanitized, missing: request.complete ? missing : [] };
      bounded(page, LIMITS.batch);
      const messageKey = key("reconcile", request.device, request.snapshotId, request.page);
      this.store.physical.reserve(`reconcile:${messageKey}`, 64);
      this.store.enqueueKernel("reconcile", messageKey, request.device, page);
      // Missing journal entries remain unknown; they do not authorize retries or release capacity.
      return this.store.receipt(scope, String(request.page), requestDigest, { ...this.receipt(request.requestId, requestDigest, request.complete ? (missing.length ? "unknown-missing-journal" : "kernel-reconciliation-pending") : "snapshot-incomplete"), missing }, sanitized);
    });
  }
  private async forward() {
    let forwarded = 0; const startedAt = Date.now();
    const failures: { key: string; code: string }[] = [];
    for (const row of this.store.kernelOutbox()) {
      if (Date.now() - startedAt > 2500) break;
      try {
      const request = this.store.kernelMessage(row);
      const reserve = request.operation === "model" ? `model:${request.key}` : row.delivery_id ? `delivery:${row.delivery_id}` : request.operation === "revoke" ? `device:${row.device_id}:${row.generation}` : `reconcile:${request.key}`;
      this.store.write("forward-attempt", () => this.store.db.query("UPDATE outbox SET attempts=attempts+1 WHERE id=?").run(row.id), reserve);
      // Calls happen only outside SQLite transactions. Failures leave the original outbox intact.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ProtocolError("unavailable")), 5000); });
      let receipt: unknown;
      try { receipt = await Promise.race([Promise.resolve().then(() => this.kernel.deliver(request)), timeout]); }
      finally { clearTimeout(timer); }
      validate("kernel-receipt", receipt);
      const typed = receipt as KernelReceipt;
      check(typed.key === request.key && typed.requestDigest === request.requestDigest, "kernel_receipt_mismatch");
      if (request.operation === "model" && typed.result) this.recordModel(request, typed.result as ModelResult);
      if (typed.state === "pending") continue;
      const expected = { accept: "recorded", report: "recorded", revoke: "revoked", reconcile: "reconciled", cancel: "control-authorized", model: "recorded" } as const;
      check(typed.state === (request.operation === "reconcile" && !request.payload.complete ? "recorded" : expected[request.operation]), "kernel_receipt_mismatch");
      this.store.fault("forward:after-kernel-commit");
      this.store.write("forward", () => {
        const existing = this.store.db.query<{ envelope: string }, [string]>("SELECT envelope FROM receipts WHERE scope='kernel' AND message_key=?").get(request.key);
        check(!existing || existing.envelope === canonical(typed), "conflict");
        if (!existing) this.store.db.query("INSERT INTO receipts VALUES ('kernel',?,?,?)").run(request.key, request.requestDigest, canonical(typed));
        this.store.db.query("UPDATE outbox SET acknowledged=1 WHERE id=?").run(row.id);
        if (request.operation === "revoke") this.store.db.query("UPDATE devices SET state='revoked',ready=0 WHERE device_id=? AND generation=?").run(row.device_id, row.generation);
        if (request.operation === "reconcile" && request.payload.complete) {
          const snapshot = this.store.db.query<{ boot_id: string; complete: number }, [string, number, string, string]>("SELECT boot_id,complete FROM snapshots WHERE device_id=? AND generation=? AND incarnation=? AND snapshot_id=?").get(row.device_id, row.generation, row.incarnation, String(request.payload.snapshotId));
          if (snapshot?.boot_id === this.store.bootId && snapshot.complete === 1 && !this.store.fenced() && typed.result?.launchable === true && Array.isArray(typed.result.missing) && typed.result.missing.length === 0 && Array.isArray(request.payload.missing) && request.payload.missing.length === 0) this.store.db.query("UPDATE devices SET ready=1 WHERE device_id=? AND generation=? AND snapshot_id=? AND state='active'").run(row.device_id, row.generation, String(request.payload.snapshotId));
        }
        if (request.operation === "cancel") {
          const control = typed.control!;
          check(control.deliveryId === row.delivery_id && control.launchDigest === request.payload.launchDigest, "kernel_receipt_mismatch");
          this.control({ ...control, requestId: key("control", control.deliveryId, control.control.requestKey) });
        }
        if (request.operation === "report") this.acknowledgeTransport(request.payload as unknown as Report);
      }, reserve);
      forwarded++;
      } catch (error) { failures.push({ key: row.message_key, code: error instanceof ProtocolError ? error.code : "unavailable" }); }
    }
    return { version: 1, state: "forwarded", forwarded, pending: this.store.kernelOutbox().length, failures };
  }
  private acknowledgeTransport(report: Report) {
    if (report.kind === "started") this.store.db.query("UPDATE outbox SET acknowledged=1 WHERE channel='device' AND kind='launch' AND delivery_id=?").run(report.deliveryId);
    if (report.kind === "control-ack" || report.kind === "cleanup") {
      const rows = this.store.db.query<OutboxRow, [string]>("SELECT * FROM outbox WHERE channel='device' AND kind='control' AND delivery_id=?").all(report.deliveryId);
      for (const row of rows) {
        const control = readStored<Control>("control", row.envelope);
        if (control.control.requestKey === report.payload.controlKey) this.store.db.query("UPDATE outbox SET acknowledged=1 WHERE id=?").run(row.id);
      }
    }
  }
  private status() {
    const devices = this.store.db.query<DeviceRow, []>("SELECT * FROM devices ORDER BY device_id,generation LIMIT 50").all().map(row => ({ device: deviceFence(row), state: row.state, reconciliationRequired: row.ready !== 1 }));
    const deliveries = this.store.db.query<DeliveryRow, []>("SELECT * FROM deliveries ORDER BY delivery_id LIMIT 50").all().map(row => ({ deliveryId: row.delivery_id, launchDigest: row.launch_digest, stopState: "unknown", evidence: this.store.db.query<{ message_key: string; acknowledged: number }, [string]>("SELECT message_key,acknowledged FROM outbox WHERE channel='kernel' AND kind='report' AND delivery_id=? ORDER BY id DESC LIMIT 16").all(row.delivery_id).map(item => ({ key: item.message_key, state: item.acknowledged ? "forwarded" : "pending" })) }));
    const totalDevices = this.store.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM devices").get()!.n;
    const totalDeliveries = this.store.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM deliveries").get()!.n;
    const pending = this.store.db.query<{ n: number }, []>("SELECT COUNT(*) n FROM outbox WHERE channel='kernel' AND acknowledged=0").get()!.n;
    return { version: 1, state: "observed", fenced: this.store.fenced(), devices, deliveries, totalDevices, totalDeliveries, evidenceLimit: 16, truncated: totalDevices > devices.length || totalDeliveries > deliveries.length, pendingKernelMessages: pending, mayDeleteData: false };
  }
}
