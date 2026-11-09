import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { canonical, check, digest, readStored, type KernelRequest, type Receipt } from "./contracts";
import { PhysicalStorage, type StorageLimits } from "./storage";

export type FaultPoint = (point: string) => void;
export type DeviceRow = { device_id: string; generation: number; incarnation: string; key_id: string; public_key: string; credential_hash: string; state: "active" | "revoking" | "revoked"; ready: number; snapshot_id: string | null };
export type DeliveryRow = { delivery_id: string; launch_digest: string; device_id: string; generation: number; incarnation: string; envelope: string };
export type OutboxRow = { id: number; channel: "kernel" | "device"; message_key: string; delivery_id: string | null; device_id: string; generation: number; incarnation: string; kind: string; envelope: string; acknowledged: number; offered: number };

/** This database contains application business records only. It never opens the kernel database. */
export class Store {
  readonly db: Database;
  readonly bootId = randomUUID();
  readonly physical: PhysicalStorage;
  constructor(directory: string, readonly fault: FaultPoint = () => {}, limits?: StorageLimits) {
    mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
    const path = join(directory, "remote-execution.sqlite");
    this.db = new Database(path, { create: true, strict: true }); chmodSync(path, 0o600);
    try {
    this.physical = new PhysicalStorage(this.db, limits);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT OR IGNORE INTO meta VALUES ('schema','1'),('fenced','0');
      CREATE TABLE IF NOT EXISTS pairings (code_hash TEXT PRIMARY KEY, device_id TEXT NOT NULL, generation INTEGER NOT NULL, incarnation TEXT NOT NULL, key_id TEXT NOT NULL, public_key TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_digest TEXT, consumed_receipt TEXT, consumed_at INTEGER);
      CREATE TABLE IF NOT EXISTS devices (device_id TEXT NOT NULL, generation INTEGER NOT NULL, incarnation TEXT NOT NULL, key_id TEXT NOT NULL, public_key TEXT NOT NULL, credential_hash TEXT NOT NULL UNIQUE, state TEXT NOT NULL, ready INTEGER NOT NULL DEFAULT 0, snapshot_id TEXT, PRIMARY KEY(device_id,generation));
      CREATE TABLE IF NOT EXISTS model_inputs (message_key TEXT PRIMARY KEY, request_digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_observations (message_key TEXT PRIMARY KEY, response TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS immutable_model_inputs_update BEFORE UPDATE ON model_inputs BEGIN SELECT RAISE(ABORT,'immutable model input'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_model_inputs_delete BEFORE DELETE ON model_inputs BEGIN SELECT RAISE(ABORT,'retain model input'); END;
      CREATE TABLE IF NOT EXISTS mappings (project_ref TEXT PRIMARY KEY, revision INTEGER NOT NULL, device_id TEXT NOT NULL, generation INTEGER NOT NULL, incarnation TEXT NOT NULL, key_id TEXT NOT NULL, workspace_ref TEXT NOT NULL, baseline TEXT NOT NULL, directory_identity TEXT NOT NULL, workspace_modes TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries (delivery_id TEXT PRIMARY KEY, launch_digest TEXT NOT NULL, device_id TEXT NOT NULL, generation INTEGER NOT NULL, incarnation TEXT NOT NULL, envelope TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox (scope TEXT NOT NULL, message_key TEXT NOT NULL, request_digest TEXT NOT NULL, envelope TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY(scope,message_key));
      CREATE TABLE IF NOT EXISTS receipts (scope TEXT NOT NULL, message_key TEXT NOT NULL, request_digest TEXT NOT NULL, envelope TEXT NOT NULL, PRIMARY KEY(scope,message_key));
      CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, message_key TEXT NOT NULL, delivery_id TEXT, device_id TEXT NOT NULL, generation INTEGER NOT NULL, incarnation TEXT NOT NULL, kind TEXT NOT NULL, envelope TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, UNIQUE(channel,message_key));
      CREATE TABLE IF NOT EXISTS delivery_workspaces (delivery_id TEXT PRIMARY KEY, workspace_ref TEXT NOT NULL, mapping_revision INTEGER NOT NULL);
      CREATE TRIGGER IF NOT EXISTS immutable_delivery_workspaces_update BEFORE UPDATE ON delivery_workspaces BEGIN SELECT RAISE(ABORT,'immutable workspace binding'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_delivery_workspaces_delete BEFORE DELETE ON delivery_workspaces BEGIN SELECT RAISE(ABORT,'immutable workspace binding'); END;
      CREATE TABLE IF NOT EXISTS delivery_status (delivery_id TEXT PRIMARY KEY, launchable INTEGER NOT NULL, boot_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS quarantined (delivery_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshots (device_id TEXT NOT NULL, generation INTEGER NOT NULL, incarnation TEXT NOT NULL, snapshot_id TEXT NOT NULL, boot_id TEXT NOT NULL, next_page INTEGER NOT NULL, complete INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(device_id,generation,incarnation,snapshot_id));
      CREATE TABLE IF NOT EXISTS snapshot_items (device_id TEXT NOT NULL, generation INTEGER NOT NULL, incarnation TEXT NOT NULL, snapshot_id TEXT NOT NULL, delivery_id TEXT NOT NULL, envelope TEXT NOT NULL, PRIMARY KEY(device_id,generation,incarnation,snapshot_id,delivery_id));
      CREATE TRIGGER IF NOT EXISTS immutable_receipts_update BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_receipts_delete BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_inbox_update BEFORE UPDATE ON inbox BEGIN SELECT RAISE(ABORT,'immutable inbox'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_inbox_delete BEFORE DELETE ON inbox BEGIN SELECT RAISE(ABORT,'immutable inbox'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_deliveries_update BEFORE UPDATE ON deliveries BEGIN SELECT RAISE(ABORT,'immutable delivery'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_deliveries_delete BEFORE DELETE ON deliveries BEGIN SELECT RAISE(ABORT,'immutable delivery'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_outbox BEFORE UPDATE OF channel,message_key,delivery_id,device_id,generation,incarnation,kind,envelope ON outbox BEGIN SELECT RAISE(ABORT,'immutable outbox'); END;
      CREATE TRIGGER IF NOT EXISTS retain_outbox BEFORE DELETE ON outbox BEGIN SELECT RAISE(ABORT,'retain outbox'); END;`);
    check(this.db.query<{ value: string }, []>("SELECT value FROM meta WHERE key='schema'").get()?.value === "1", "unsupported_version");
    check(!this.db.query("SELECT 1 FROM deliveries d LEFT JOIN storage_reserves r ON r.id='delivery:'||d.delivery_id WHERE r.id IS NULL LIMIT 1").get(), "storage_recovery_required", "Retained delivery has no physical reserve; explicit recovery required");
    // A process restart never implies the device stopped or that a prior snapshot is current.
    this.write("restart", () => this.db.exec("UPDATE devices SET ready=0"), "$control");
    } catch (error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  write<T>(label: string, fn: () => T, reserve?: string): T {
    const result = this.physical.write(() => { const value = fn(); this.fault(`${label}:before-commit`); return value; }, reserve);
    this.fault(`${label}:after-commit`); return result;
  }
  fenced() { return this.db.query<{ value: string }, []>("SELECT value FROM meta WHERE key='fenced'").get()!.value === "1"; }
  fence() { this.db.exec("UPDATE meta SET value='1' WHERE key='fenced'; UPDATE devices SET ready=0"); }
  device(deviceId: string, generation: number) { return this.db.query<DeviceRow, [string, number]>("SELECT * FROM devices WHERE device_id=? AND generation=?").get(deviceId, generation); }
  delivery(deliveryId: string) { return this.db.query<DeliveryRow, [string]>("SELECT * FROM deliveries WHERE delivery_id=?").get(deliveryId); }
  original<T>(scope: string, key: string, requestDigest: string): T | null {
    const row = this.db.query<{ request_digest: string; envelope: string }, [string, string]>("SELECT request_digest,envelope FROM receipts WHERE scope=? AND message_key=?").get(scope, key);
    if (!row) return null;
    check(row.request_digest === requestDigest, "conflict");
    // Receipts can be richer than the common receipt header. The header is always checked.
    const value = JSON.parse(row.envelope) as Receipt;
    const { version, requestId, receiptId, requestDigest: storedDigest, committedAt, state } = value;
    readStored("receipt", canonical({ version, requestId, receiptId, requestDigest: storedDigest, committedAt, state }));
    check(storedDigest === requestDigest, "conflict"); return value as T;
  }
  receipt<T extends Receipt>(scope: string, key: string, requestDigest: string, value: T, envelope?: unknown): T {
    this.db.query("INSERT INTO receipts VALUES (?,?,?,?)").run(scope, key, requestDigest, canonical(value));
    if (envelope !== undefined) this.db.query("INSERT INTO inbox VALUES (?,?,?,?,?)").run(scope, key, requestDigest, canonical(envelope), canonical(value));
    return value;
  }
  enqueue(channel: "kernel" | "device", key: string, deliveryId: string | null, device: { deviceId: string; generation: number; incarnation: string }, kind: string, envelope: unknown) {
    const previous = this.db.query<{ envelope: string }, [string, string]>("SELECT envelope FROM outbox WHERE channel=? AND message_key=?").get(channel, key);
    if (previous) { check(previous.envelope === canonical(envelope), "conflict"); return; }
    this.db.query("INSERT INTO outbox(channel,message_key,delivery_id,device_id,generation,incarnation,kind,envelope) VALUES (?,?,?,?,?,?,?,?)").run(channel, key, deliveryId, device.deviceId, device.generation, device.incarnation, kind, canonical(envelope));
  }
  kernelOutbox(): OutboxRow[] { return this.db.query<OutboxRow, []>("SELECT * FROM outbox WHERE channel='kernel' AND acknowledged=0 ORDER BY CASE WHEN kind='revoke' THEN 0 WHEN kind='cancel' THEN 1 WHEN kind='report' AND json_extract(envelope,'$.payload.kind') IN ('final','stop','control-ack') THEN 2 ELSE 3 END,attempts,id LIMIT 100").all(); }
  kernelMessage(row: OutboxRow): KernelRequest { return readStored<KernelRequest>("kernel-request", row.envelope); }
  enqueueKernel(operation: KernelRequest["operation"], key: string, device: { deviceId: string; generation: number; incarnation: string }, payload: Record<string, unknown>, deliveryId: string | null = null) {
    const request: KernelRequest = { version: 1, operation, key, requestDigest: digest({ operation, key, payload }), payload };
    this.enqueue("kernel", key, deliveryId, device, operation, request);
  }
}
