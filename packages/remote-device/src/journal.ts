import { Database } from "bun:sqlite";
import { join } from "node:path";
import { lstatSync } from "node:fs";
import { z } from "zod";
import { kernelCleanupInputSchema, kernelCleanupReceiptSchema, type KernelCleanupInput } from "@chrona/contracts/steward";
import { privateRoot } from "@chrona/git-workspaces";
import { receiptSchema as modelReceiptSchema } from "@chrona/remote-model";
import { appCanonical, appDigest, controlSchema, deliverySchema, executionDigest, receiptSchema, reportSchema, validateReport, type Delivery, type Report } from "./protocol";
import { privateFile, syncDirectory } from "./private-files";
import { PhysicalStorage, type StorageLimits } from "./storage";

const stateSchema = z.enum(["intent", "spawn_possible", "running", "unknown", "stopped"]);
export type AttemptState = z.infer<typeof stateSchema>;
type AttemptRow = { delivery_id: string; launch_digest: string; envelope: string; state: string; journal_seq: number; source_watermark: number; process_identity: string | null; locks: string; local_workspace_ref: string };
export type Attempt = { delivery: Delivery; localWorkspaceRef: string; state: AttemptState; journalSeq: number; sourceWatermark: number; processIdentity: { id: string; scope: string } | null; locks: { key: string; token: string }[] };
export type PendingReport = { id: number; report: Report };

/** OS-backed exclusive SQLite lock avoids PID guessing and stale directory-lock theft. */
export class DeviceDirectoryLock {
  private db: Database;
  constructor(root: string) {
    privateRoot(root); privateFile(join(root, "directory-lock.sqlite"), true);
    this.db = new Database(join(root, "directory-lock.sqlite"));
    try { this.db.exec("PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=0; BEGIN EXCLUSIVE"); syncDirectory(root); }
    catch { this.db.close(); throw new Error("Device directory is already in use"); }
  }
  close() { this.db.close(); }
}

/** All effect boundaries and outbound evidence are committed before they can leave this process. */
export class Journal {
  readonly db: Database;
  readonly physical: PhysicalStorage;
  constructor(readonly root: string, limits?: StorageLimits) {
    privateRoot(root); privateFile(join(root, "journal.sqlite"), true);
    for (const name of ["journal.sqlite-wal", "journal.sqlite-shm", "journal.sqlite-journal"]) {
      const path = join(root, name); if (lstatSync(path, { throwIfNoEntry: false })) privateFile(path);
    }
    this.db = new Database(join(root, "journal.sqlite"), { strict: true });
    try {
      this.physical = new PhysicalStorage(this.db, limits);
      this.db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0");
      const version = this.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
      if (version !== 0 && version !== 1) throw new Error("Unsupported device journal version");
      this.db.exec(`CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS attempts(delivery_id TEXT PRIMARY KEY,launch_digest TEXT NOT NULL,envelope TEXT NOT NULL,state TEXT NOT NULL,journal_seq INTEGER NOT NULL,source_watermark INTEGER NOT NULL,process_identity TEXT,locks TEXT NOT NULL,local_workspace_ref TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,delivery_id TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS capacity(kind TEXT NOT NULL,identity TEXT NOT NULL,delivery_id TEXT NOT NULL REFERENCES attempts(delivery_id),PRIMARY KEY(kind,identity));
        CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,delivery_id TEXT NOT NULL REFERENCES attempts(delivery_id),report_key TEXT NOT NULL,digest TEXT NOT NULL,envelope TEXT NOT NULL,receipt TEXT,UNIQUE(delivery_id,report_key));
        CREATE TABLE IF NOT EXISTS controls(delivery_id TEXT NOT NULL REFERENCES attempts(delivery_id),control_key TEXT NOT NULL,digest TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(delivery_id,control_key));
        CREATE TABLE IF NOT EXISTS models(delivery_id TEXT NOT NULL REFERENCES attempts(delivery_id),model_key TEXT NOT NULL,digest TEXT NOT NULL,input TEXT NOT NULL,receipt TEXT,PRIMARY KEY(delivery_id,model_key));
        CREATE TABLE IF NOT EXISTS cleanups(delivery_id TEXT NOT NULL REFERENCES attempts(delivery_id),command_key TEXT NOT NULL,digest TEXT NOT NULL,input TEXT NOT NULL,receipt TEXT,PRIMARY KEY(delivery_id,command_key));
        PRAGMA user_version=1;`);
      if (this.db.query<{ quick_check: string }, []>("PRAGMA quick_check").get()!.quick_check !== "ok") throw new Error("Corrupt device journal");
      for (const name of ["journal.sqlite", "journal.sqlite-wal", "journal.sqlite-shm", "journal.sqlite-journal"]) {
        const path = join(root, name); if (lstatSync(path, { throwIfNoEntry: false })) privateFile(path);
      }
      syncDirectory(root);
      // Read and validate every stored attempt/report before recovery can affect a process.
      if (this.db.query("SELECT 1 FROM attempts a LEFT JOIN storage_reserves r ON r.id='delivery:'||a.delivery_id WHERE r.id IS NULL LIMIT 1").get()) throw new Error("Retained attempt has no physical reserve; explicit recovery required");
      this.attempts(); this.validateRetained();
    } catch (error) { this.db.close(); throw error; }
  }
  write<T>(body: () => T, reserve?: string): T { return this.physical.write(body, reserve); }
  private event(id: string, kind: string, body: unknown) {
    const result = this.db.query("INSERT INTO events(delivery_id,kind,body) VALUES (?,?,?)").run(id, kind, JSON.stringify(body));
    this.db.query("UPDATE attempts SET journal_seq=? WHERE delivery_id=?").run(Number(result.lastInsertRowid), id);
  }
  private decode(row: AttemptRow): Attempt {
    const delivery = deliverySchema.parse(JSON.parse(row.envelope));
    if (delivery.deliveryId !== row.delivery_id || delivery.launchDigest !== row.launch_digest) throw new Error("Journal immutable identity mismatch");
    return { delivery, localWorkspaceRef: z.string().min(1).max(200).parse(row.local_workspace_ref), state: stateSchema.parse(row.state), journalSeq: z.number().int().nonnegative().parse(row.journal_seq), sourceWatermark: z.number().int().nonnegative().parse(row.source_watermark), processIdentity: row.process_identity === null ? null : z.object({ id: z.string(), scope: z.string() }).strict().parse(JSON.parse(row.process_identity)), locks: z.array(z.object({ key: z.string(), token: z.string() }).strict()).max(2).parse(JSON.parse(row.locks)) };
  }
  get(id: string): Attempt | null { const row = this.db.query<AttemptRow, [string]>("SELECT * FROM attempts WHERE delivery_id=?").get(id); return row ? this.decode(row) : null; }
  attempts(): Attempt[] { return this.db.query<AttemptRow, []>("SELECT * FROM attempts ORDER BY delivery_id").all().map(row => this.decode(row)); }
  private validateRetained() {
    for (const row of this.db.query<{ delivery_id: string; command_key: string; digest: string; input: string; receipt: string | null }, []>("SELECT * FROM cleanups").all()) {
      const command = kernelCleanupInputSchema.parse(JSON.parse(row.input));
      if (row.command_key !== command.commandKey || row.digest !== appDigest(command)) throw new Error("Retained cleanup checksum mismatch");
      this.validateCleanup(row.delivery_id, command, row.receipt === null ? undefined : JSON.parse(row.receipt));
    }
    for (const row of this.db.query<{ envelope: string; digest: string; receipt: string | null }, []>("SELECT envelope,digest,receipt FROM outbox").all()) {
      const report = reportSchema.parse(JSON.parse(row.envelope)); validateReport(report);
      const { requestId: _, reportKey: __, ...business } = report;
      if (appDigest(business) !== row.digest) throw new Error("Outbox checksum mismatch");
      if (row.receipt !== null) {
        const receipt = receiptSchema.parse(JSON.parse(row.receipt));
        if (receipt.requestId !== report.requestId || receipt.requestDigest !== row.digest || receipt.state !== "durably-received-evidence-unverified") throw new Error("Retained report receipt mismatch");
      }
    }
    for (const row of this.db.query<{ control_key: string; digest: string; body: string; state: string }, []>("SELECT control_key,digest,body,state FROM controls").all()) {
      const control = controlSchema.parse(JSON.parse(row.body)); z.enum(["possible", "applied"]).parse(row.state);
      if (control.requestKey !== row.control_key || appDigest(control) !== row.digest) throw new Error("Retained control checksum mismatch");
    }
    for (const row of this.db.query<{ delivery_id: string; digest: string; input: string; receipt: string | null }, []>("SELECT delivery_id,digest,input,receipt FROM models").all()) {
      const attempt = this.get(row.delivery_id); if (!attempt) throw new Error("Retained model delivery missing");
      const input: unknown = JSON.parse(row.input); this.validateModelInput(attempt, input);
      if (appDigest(input) !== row.digest) throw new Error("Retained model checksum mismatch");
      if (row.receipt !== null) modelReceiptSchema.parse(JSON.parse(row.receipt));
    }
  }
  private validateCleanup(id: string, command: KernelCleanupInput, receipt?: unknown) {
    const attempt = this.get(id);
    if (!attempt || command.workId !== attempt.delivery.packet.target.workId) throw new Error("Cleanup work fence mismatch");
    if (receipt !== undefined) {
      const parsed = kernelCleanupReceiptSchema.parse(receipt);
      if (parsed.state === "pending" || parsed.workId !== command.workId || parsed.workspaceRef !== attempt.delivery.packet.launch.workspaceRef || command.op === "confirm" && parsed.previewDigest !== command.previewDigest) throw new Error("Cleanup receipt fence mismatch");
    }
  }
  cleanupRequest(id: string, raw: KernelCleanupInput) {
    const command = kernelCleanupInputSchema.parse(raw);
    return this.write(() => {
      this.validateCleanup(id, command);
      const digest = appDigest(command), previous = this.db.query<{ digest: string; receipt: string | null }, [string, string]>("SELECT digest,receipt FROM cleanups WHERE delivery_id=? AND command_key=?").get(id, command.commandKey);
      if (previous) {
        if (previous.digest !== digest) throw new Error("Cleanup command key conflict");
        return { created: false, receipt: previous.receipt === null ? null : kernelCleanupReceiptSchema.parse(JSON.parse(previous.receipt)) };
      }
      const count = this.db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM cleanups WHERE delivery_id=?").get(id)!.n;
      if (count >= 100) throw new Error("Cleanup journal capacity reached");
      this.db.query("INSERT INTO cleanups VALUES (?,?,?,?,NULL)").run(id, command.commandKey, digest, JSON.stringify(command)); this.event(id, "cleanup-possible", { commandKey: command.commandKey, digest });
      return { created: true, receipt: null };
    });
  }
  cleanupReceipt(id: string, command: KernelCleanupInput, receipt: unknown) {
    const parsed = kernelCleanupReceiptSchema.parse(receipt);
    this.write(() => {
      this.validateCleanup(id, command, parsed);
      const row = this.db.query<{ digest: string; receipt: string | null }, [string, string]>("SELECT digest,receipt FROM cleanups WHERE delivery_id=? AND command_key=?").get(id, command.commandKey);
      if (!row || row.digest !== appDigest(command)) throw new Error("Unknown cleanup reservation");
      if (row.receipt !== null) { if (appDigest(JSON.parse(row.receipt)) !== appDigest(parsed)) throw new Error("Cleanup receipt is immutable"); return; }
      this.db.query("UPDATE cleanups SET receipt=? WHERE delivery_id=? AND command_key=?").run(JSON.stringify(parsed), id, command.commandKey); this.event(id, "cleanup-observed", { commandKey: command.commandKey });
    }, `delivery:${id}`);
  }
  bind(device: unknown) {
    this.write(() => {
      const current = this.db.query<{ value: string }, []>("SELECT value FROM meta WHERE key='device'").get();
      if (current && current.value !== executionDigest(device)) throw new Error("Journal belongs to a different device fence; retained evidence must be settled before re-pairing");
      this.db.query("INSERT OR IGNORE INTO meta VALUES ('device',?)").run(executionDigest(device));
    }, "$control");
  }
  accept(delivery: Delivery, localWorkspaceRef: string, reconciledReceiver = false): { attempt: Attempt; created: boolean } {
    return this.write(() => {
      const previous = this.get(delivery.deliveryId);
      if (previous) {
        if (previous.localWorkspaceRef !== localWorkspaceRef) throw new Error("Immutable local workspace alias mismatch");
        if (executionDigest({ target: previous.delivery.packet.target, launch: previous.delivery.packet.launch }) !== executionDigest({ target: delivery.packet.target, launch: delivery.packet.launch })) throw new Error("Delivery replay changed immutable target or launch");
        return { attempt: previous, created: false };
      }
      if (this.attempts().length >= 100) throw new Error("Device journal capacity reached; finite retention requires an explicit archival protocol");
      this.physical.reserve(`delivery:${delivery.deliveryId}`, 2048);
      const { target } = delivery.packet;
      const receiver = executionDigest({ workspaceId: target.workspaceId, ownerId: target.ownerId, moduleId: target.receiverModuleId, hash: target.receiverHash, activationId: target.receiverActivationId });
      const binding = this.db.query<{ value: string }, []>("SELECT value FROM meta WHERE key='receiver'").get();
      if (binding && binding.value !== receiver) {
        const occupied = this.db.query("SELECT 1 FROM capacity LIMIT 1").get();
        if (!reconciledReceiver || occupied || this.pending().length || this.attempts().some(attempt => attempt.state !== "stopped")) throw new Error("Receiver activation fence changed; reconcile retained journal before migration");
        // Only an authenticated, reconciled current poll may advance the receiver.
        // Every old attempt and its signed target remains immutable.
        this.db.query("UPDATE meta SET value=? WHERE key='receiver'").run(receiver);
      }
      this.db.query("INSERT OR IGNORE INTO meta VALUES ('receiver',?)").run(receiver);
      this.db.query("INSERT INTO attempts VALUES (?,?,?,'intent',0,0,NULL,'[]',?)").run(delivery.deliveryId, delivery.launchDigest, JSON.stringify(delivery), z.string().min(1).max(200).parse(localWorkspaceRef));
      // Stable capacity identities deliberately omit generation and target revision.
      const slot = this.db.query("SELECT 1 FROM capacity WHERE kind='subject' AND identity=?").get(target.subjectId) ? `${target.subjectId}#2` : target.subjectId;
      this.db.query("INSERT INTO capacity VALUES ('subject',?,?)").run(slot, delivery.deliveryId);
      this.db.query("INSERT INTO capacity VALUES ('target',?,?)").run(delivery.packet.launch.target.directoryIdentity, delivery.deliveryId);
      this.event(delivery.deliveryId, "intent", { target, launchDigest: delivery.launchDigest });
      return { attempt: this.get(delivery.deliveryId)!, created: true };
    });
  }
  transition(id: string, state: AttemptState, identity?: { id: string; scope: string }) {
    this.write(() => {
      const current = this.get(id); if (!current) throw new Error("Unknown attempt");
      const allowed: Record<AttemptState, AttemptState[]> = { intent: ["spawn_possible", "stopped"], spawn_possible: ["running", "unknown", "stopped"], running: ["unknown", "stopped"], unknown: ["unknown"], stopped: [] };
      if (!allowed[current.state].includes(state)) throw new Error(`Forbidden journal transition ${current.state} -> ${state}`);
      this.db.query("UPDATE attempts SET state=?,process_identity=COALESCE(?,process_identity) WHERE delivery_id=?").run(state, identity ? JSON.stringify(identity) : null, id);
      this.event(id, state, identity ?? {});
      if (state === "stopped") this.db.query("DELETE FROM capacity WHERE delivery_id=?").run(id);
    }, `delivery:${id}`);
  }
  recordLock(id: string, lock: { key: string; token: string }) {
    this.write(() => { const current = this.get(id)!; if (current.state !== "intent") throw new Error("Workspace lock acquired after spawn boundary"); this.db.query("UPDATE attempts SET locks=? WHERE delivery_id=?").run(JSON.stringify([...current.locks, lock]), id); this.event(id, "workspace-lock", lock); }, `delivery:${id}`);
  }
  sourceWithinBudget(report: Report): boolean {
    const sources = this.db.query<{ envelope: string }, [string]>("SELECT envelope FROM outbox WHERE delivery_id=? AND report_key LIKE 'source:%'").all(report.deliveryId);
    const bytes = sources.reduce((sum, row) => sum + Buffer.byteLength(appCanonical(JSON.parse(row.envelope))), 0);
    // Leave app quota for controls, cleanup, the reserved gap, final and proof.
    return sources.length < 512 && bytes + Buffer.byteLength(appCanonical(report)) <= 262144;
  }
  enqueue(report: Report) {
    validateReport(report);
    const { requestId: _, reportKey: __, ...business } = report, digest = appDigest(business);
    const maximum = report.kind === "source" ? 32768 : report.kind === "final" ? 196608 : 4096;
    if (Buffer.byteLength(JSON.stringify(report.payload)) > maximum || Buffer.byteLength(JSON.stringify(report)) > 262144) throw new Error("Report byte limit exceeded");
    const fixedKey = report.kind === "source" ? `source:${(report.payload.records as { sequence: number }[])[0]!.sequence}` : report.kind === "stop" ? `stop:${appDigest(report.payload)}` : report.kind === "control-ack" ? `ack:${appDigest([report.payload.controlKey])}` : report.kind === "cleanup" ? `cleanup:${appDigest([report.payload.controlKey])}` : report.kind;
    if (report.reportKey !== fixedKey) throw new Error("Report must use its fixed business key");
    this.write(() => {
      const attempt = this.get(report.deliveryId); if (!attempt || attempt.delivery.launchDigest !== report.launchDigest) throw new Error("Outbox fence mismatch");
      const previous = this.db.query<{ digest: string }, [string, string]>("SELECT digest FROM outbox WHERE delivery_id=? AND report_key=?").get(report.deliveryId, report.reportKey);
      if (previous) { if (previous.digest !== digest) throw new Error("Conflicting report replay"); return; }
      if (report.kind === "source") {
        const records = report.payload.records as { sequence: number }[];
        let watermark = attempt.sourceWatermark;
        for (const record of records) if (record.sequence !== ++watermark) throw new Error("Non-contiguous source journal");
        const bytes = this.db.query<{ n: number }, [string]>("SELECT COALESCE(SUM(length(CAST(envelope AS BLOB))),0) AS n FROM outbox WHERE delivery_id=? AND report_key LIKE 'source:%'").get(report.deliveryId)!.n;
        const gap = (report.payload.records as { payload: { type: string } }[]).every(record => record.payload.type === "gap");
        const count = this.db.query<{ n: number }, [string]>("SELECT COUNT(*) n FROM outbox WHERE delivery_id=? AND report_key LIKE 'source:%'").get(report.deliveryId)!.n;
        if (count >= 513 || (!gap && count >= 512) || bytes + Buffer.byteLength(JSON.stringify(report)) > 262144 + (gap ? 4096 : 0)) throw new Error("Source journal capacity reached");
        this.db.query("UPDATE attempts SET source_watermark=? WHERE delivery_id=?").run(watermark, report.deliveryId);
      }
      if (report.kind === "stop" && this.db.query<{ n: number }, [string]>("SELECT COUNT(*) n FROM outbox WHERE delivery_id=? AND report_key LIKE 'stop:%'").get(report.deliveryId)!.n >= 16) throw new Error("Stop journal capacity reached");
      if ((report.kind === "control-ack" || report.kind === "cleanup") && !this.db.query("SELECT 1 FROM controls WHERE delivery_id=? AND control_key=?").get(report.deliveryId, String(report.payload.controlKey))) throw new Error("Unknown control report reservation");
      this.db.query("INSERT INTO outbox(delivery_id,report_key,digest,envelope) VALUES (?,?,?,?)").run(report.deliveryId, report.reportKey, digest, JSON.stringify(report));
      this.event(report.deliveryId, `outbox:${report.kind}`, { reportKey: report.reportKey, digest });
    }, `delivery:${report.deliveryId}`);
  }
  pending(): PendingReport[] {
    return this.db.query<{ id: number; envelope: string; digest: string }, []>("SELECT id,envelope,digest FROM outbox WHERE receipt IS NULL ORDER BY id").all().map(row => {
      const report = reportSchema.parse(JSON.parse(row.envelope)); validateReport(report);
      const { requestId: _, reportKey: __, ...business } = report;
      if (appDigest(business) !== row.digest) throw new Error("Outbox checksum mismatch");
      return { id: row.id, report };
    });
  }
  acknowledge(id: number, receipt: unknown) {
    const row = this.db.query<{ delivery_id: string }, [number]>("SELECT delivery_id FROM outbox WHERE id=?").get(id);
    if (!row) throw new Error("Unknown report acknowledgement");
    if (Buffer.byteLength(JSON.stringify(receipt)) > 4096) throw new Error("Report receipt byte limit exceeded");
    this.write(() => this.db.query("UPDATE outbox SET receipt=? WHERE id=? AND receipt IS NULL").run(JSON.stringify(receipt), id), `delivery:${row.delivery_id}`);
  }
  control(id: string, key: string, body: unknown): "new" | "applied" | "possible" {
    return this.write(() => {
      const digest = appDigest(body), row = this.db.query<{ digest: string; state: string }, [string, string]>("SELECT digest,state FROM controls WHERE delivery_id=? AND control_key=?").get(id, key);
      if (row) { if (row.digest !== digest) throw new Error("Control key conflict"); return row.state === "applied" ? "applied" : "possible"; }
      const count = this.db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM controls WHERE delivery_id=?").get(id)!.n;
      const control = controlSchema.parse(body), cancellation = control.operation === "control" && control.payload.operation === "cancel";
      if (count >= 100 || (count >= 99 && !cancellation)) throw new Error("Control journal capacity reached; last slot is reserved for cancellation");
      this.db.query("INSERT INTO controls VALUES (?,?,?,?,'possible')").run(id, key, digest, JSON.stringify(body));
      this.event(id, "control-possible", { key, digest }); return "new";
    }, (() => { const control = controlSchema.parse(body); return control.operation === "control" && control.payload.operation === "cancel" ? `delivery:${id}` : undefined; })());
  }
  private validateModelInput(attempt: Attempt, input: unknown) {
    z.object({ prompt: z.string().min(1).max(200000), system: z.string().max(20000).optional(), maxOutputTokens: z.number().int().positive().max(attempt.delivery.packet.launch.budget.maxOutputTokens) }).strict().parse(input);
  }
  modelRequest(id: string, key: string, input: unknown) {
    this.write(() => {
      const attempt = this.get(id);
      if (!attempt || !["spawn_possible", "running"].includes(attempt.state)) throw new Error("Model request is outside its live delivery");
      z.string().regex(/^[\w:.-]{1,200}$/).parse(key);
      this.validateModelInput(attempt, input);
      if (Date.parse(attempt.delivery.packet.launch.deadlineAt) <= Date.now()) throw new Error("Model delivery deadline expired");
      const digest = appDigest(input), previous = this.db.query<{ digest: string }, [string, string]>("SELECT digest FROM models WHERE delivery_id=? AND model_key=?").get(id, key);
      if (previous) throw new Error(previous.digest === digest ? "Unknown model request must not replay" : "Model key input conflict");
      const count = this.db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM models WHERE delivery_id=?").get(id)!.n;
      if (count >= attempt.delivery.packet.launch.budget.maxModelCalls || Buffer.byteLength(JSON.stringify(input)) > 524288) throw new Error("Model journal capacity exceeded");
      this.physical.reserve(`model:${id}:${key}`, 256);
      this.db.query("INSERT INTO models VALUES (?,?,?,?,NULL)").run(id, key, digest, JSON.stringify(input));
      this.event(id, "model-possible", { key, digest });
    });
  }
  modelReceipt(id: string, key: string, receipt: unknown) {
    const parsed = modelReceiptSchema.parse(receipt);
    if (Buffer.byteLength(JSON.stringify(parsed)) > 524288) throw new Error("Model receipt byte limit exceeded");
    if (!this.db.query("SELECT 1 FROM models WHERE delivery_id=? AND model_key=?").get(id, key)) throw new Error("Unknown model reservation");
    this.write(() => {
      const row = this.db.query<{ receipt: string | null }, [string, string]>("SELECT receipt FROM models WHERE delivery_id=? AND model_key=?").get(id, key);
      if (!row) throw new Error("Unknown model reservation");
      if (row.receipt !== null) { if (appDigest(JSON.parse(row.receipt)) !== appDigest(parsed)) throw new Error("Conflicting model receipt"); return; }
      this.db.query("UPDATE models SET receipt=? WHERE delivery_id=? AND model_key=?").run(JSON.stringify(parsed), id, key); this.event(id, "model-observed", { key });
    }, `model:${id}:${key}`);
  }
  appliedControl(id: string, key: string, report: Report) {
    this.write(() => { this.enqueue(report); this.db.query("UPDATE controls SET state='applied' WHERE delivery_id=? AND control_key=?").run(id, key); this.event(id, "control-applied", { key }); }, `delivery:${id}`);
  }
  close() { this.db.close(); }
}
