import { check } from "./contracts";
import type { Store } from "./store";

const RECEIPT_BYTES = 1_048_576;
const DEVICE_RECEIPT_BYTES = 2_097_152;
const GLOBAL_RECEIPT_BYTES = 16_777_216;
const TERMINAL_BYTES = 262_144;
const STOP_BYTES = 81_920;
const CANCEL_BYTES = 16_384;
const GAP_BYTES = 4_096;
// Complete canonical source report envelopes, coordinated with the producer.
export const SOURCE_BYTES = 262_144;
const SOURCE_RECEIPTS = 1_024;
const CONTROL_RECEIPTS = 128;

export type ReportKind = "ordinary" | "source" | "gap" | "final" | "stop" | "control-ack" | "ordinary-ack";
type Ledger = {
  delivery_id: string; device_id: string; generation: number;
  bytes: number; terminal_bytes: number; cancel_bytes: number; gap_bytes: number; source_bytes: number; stop_bytes: number;
  source_count: number; stop_count: number; control_count: number; ack_count: number; gap_count: number;
};

/**
 * Durable logical accounting: charge the UTF-8 byte length of one canonical
 * envelope once, even if inbox/receipt/outbox store multiple copies. Callers
 * deduplicate before charging and wrap each reservation and its business writes
 * in the same Store.write transaction; a thrown check must roll it all back.
 * PhysicalStorage separately bounds duplicate representations, pages and journals.
 * Filesystem exhaustion can still prevent a commit. No reservation is automatically released,
 * including after a final report, a restart, or an unknown stop.
 */
export function initializeBudget(store: Store): void {
  store.write("budget-schema", () => {
  store.db.exec(`CREATE TABLE IF NOT EXISTS ledger (
    delivery_id TEXT PRIMARY KEY NOT NULL,
    device_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation >= 0),
    bytes INTEGER NOT NULL DEFAULT 0 CHECK (bytes BETWEEN 0 AND 1048576),
    terminal_bytes INTEGER NOT NULL DEFAULT 0 CHECK (terminal_bytes BETWEEN 0 AND 262144),
    cancel_bytes INTEGER NOT NULL DEFAULT 0 CHECK (cancel_bytes BETWEEN 0 AND 16384),
    gap_bytes INTEGER NOT NULL DEFAULT 0 CHECK (gap_bytes BETWEEN 0 AND 4096),
    source_count INTEGER NOT NULL DEFAULT 0 CHECK (source_count BETWEEN 0 AND 8192),
    stop_count INTEGER NOT NULL DEFAULT 0 CHECK (stop_count BETWEEN 0 AND 16),
    control_count INTEGER NOT NULL DEFAULT 0 CHECK (control_count BETWEEN 0 AND 128),
    ack_count INTEGER NOT NULL DEFAULT 0 CHECK (ack_count BETWEEN 0 AND 128),
    gap_count INTEGER NOT NULL DEFAULT 0 CHECK (gap_count BETWEEN 0 AND 8192),
    CHECK (terminal_bytes + cancel_bytes + gap_bytes <= bytes)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS ledger_device ON ledger(device_id);`);
  if (!store.db.query<{ name: string }, []>("PRAGMA table_info(ledger)").all().some(column => column.name === "source_bytes")) {
    store.db.exec(`ALTER TABLE ledger ADD COLUMN source_bytes INTEGER NOT NULL DEFAULT 0;
      UPDATE ledger SET source_bytes=COALESCE((SELECT SUM(length(CAST(envelope AS BLOB))) FROM inbox
        WHERE scope LIKE 'report:%' AND json_extract(envelope,'$.deliveryId')=ledger.delivery_id
          AND json_extract(envelope,'$.kind')='source'),0)-gap_bytes;`);
  }
  if (!store.db.query<{ name: string }, []>("PRAGMA table_info(ledger)").all().some(column => column.name === "stop_bytes")) {
    store.db.exec(`ALTER TABLE ledger ADD COLUMN stop_bytes INTEGER NOT NULL DEFAULT 0;
      UPDATE ledger SET stop_bytes=COALESCE((SELECT SUM(length(CAST(envelope AS BLOB))) FROM inbox
        WHERE scope LIKE 'report:%' AND json_extract(envelope,'$.deliveryId')=ledger.delivery_id
          AND json_extract(envelope,'$.kind')='stop'),0);
      UPDATE ledger SET terminal_bytes=terminal_bytes-stop_bytes;`);
  }
  }, "$control");
}

function ledger(store: Store, deliveryId: string): Ledger {
  const row = store.db.query<Ledger, [string]>("SELECT * FROM ledger WHERE delivery_id=?").get(deliveryId);
  check(row, "not_found", "Delivery has no budget reservation");
  return row;
}

function footprint(row: Ledger): number {
  return row.bytes + TERMINAL_BYTES - row.terminal_bytes
    + CANCEL_BYTES - row.cancel_bytes + GAP_BYTES - row.gap_bytes
    + Math.max(0, SOURCE_BYTES - row.source_bytes) + STOP_BYTES - row.stop_bytes;
}

function enforceCapacity(store: Store, row: Ledger): void {
  check(footprint(row) <= RECEIPT_BYTES, "budget_exceeded", "Delivery receipt budget exhausted");
  const totals = store.db.query<{ device_bytes: number; global_bytes: number }, [string]>(`
    SELECT COALESCE(SUM(CASE WHEN device_id=? THEN
      bytes + 262144 - terminal_bytes + 16384 - cancel_bytes + 4096 - gap_bytes
        + MAX(0,262144-source_bytes) + 81920-stop_bytes
      ELSE 0 END), 0) AS device_bytes,
      COALESCE(SUM(bytes + 262144 - terminal_bytes + 16384 - cancel_bytes + 4096 - gap_bytes
        + MAX(0,262144-source_bytes) + 81920-stop_bytes), 0) AS global_bytes
    FROM ledger`).get(row.device_id)!;
  // Device capacity spans every retained generation of that device.
  check(totals.device_bytes <= DEVICE_RECEIPT_BYTES, "budget_exceeded", "Device receipt budget exhausted");
  check(totals.global_bytes <= GLOBAL_RECEIPT_BYTES, "budget_exceeded", "Global receipt budget exhausted");
}

/** Insert once for a new delivery. Retries must be deduplicated by the caller. */
export function reserveDelivery(store: Store, deliveryId: string, deviceId: string, generation: number): void {
  check(Number.isSafeInteger(generation) && generation >= 0, "invalid");
  store.db.query("INSERT INTO ledger(delivery_id,device_id,generation) VALUES (?,?,?)")
    .run(deliveryId, deviceId, generation);
  enforceCapacity(store, ledger(store, deliveryId));
  store.physical.reserve(`delivery:${deliveryId}`, 2048);
}

function charge(row: Ledger, bytes: number): void {
  check(Number.isSafeInteger(bytes) && bytes >= 0, "invalid", "Bytes must be a nonnegative safe integer");
  check(bytes <= RECEIPT_BYTES - row.bytes, "budget_exceeded", "Delivery receipt budget exhausted");
  row.bytes += bytes;
}

function persist(store: Store, row: Ledger): void {
  check(row.terminal_bytes <= TERMINAL_BYTES, "budget_exceeded", "Terminal receipt reservation exhausted");
  check(row.stop_bytes <= STOP_BYTES, "budget_exceeded", "Stop receipt reservation exhausted");
  check(row.cancel_bytes <= CANCEL_BYTES, "budget_exceeded", "Cancellation receipt reservation exhausted");
  check(row.gap_bytes <= GAP_BYTES, "budget_exceeded", "Gap receipt reservation exhausted");
  check(row.source_count <= SOURCE_RECEIPTS, "budget_exceeded", "Source receipt count exhausted");
  check(row.stop_count <= 16, "budget_exceeded", "Stop receipt count exhausted");
  check(row.control_count <= CONTROL_RECEIPTS, "budget_exceeded", "Control count exhausted");
  check(row.ack_count <= CONTROL_RECEIPTS, "budget_exceeded", "Control acknowledgement count exhausted");
  store.db.query(`UPDATE ledger SET bytes=?,terminal_bytes=?,cancel_bytes=?,gap_bytes=?,
    source_count=?,stop_count=?,control_count=?,ack_count=?,gap_count=?,source_bytes=?,stop_bytes=? WHERE delivery_id=?`)
    .run(row.bytes, row.terminal_bytes, row.cancel_bytes, row.gap_bytes,
      row.source_count, row.stop_count, row.control_count, row.ack_count, row.gap_count, row.source_bytes, row.stop_bytes, row.delivery_id);
  enforceCapacity(store, row);
}

/** bytes is the complete canonical envelope size, including headers and metadata. */
export function reserveReport(store: Store, deliveryId: string, bytes: number, kind: ReportKind): void {
  const row = ledger(store, deliveryId);
  charge(row, bytes);
  switch (kind) {
    case "ordinary": break;
    case "source":
      row.source_bytes += bytes;
      check(row.source_bytes <= SOURCE_BYTES, "budget_exceeded", "Cumulative source envelope budget exhausted");
      row.source_count++;
      check(row.source_count <= SOURCE_RECEIPTS - (row.gap_count === 0 ? 1 : 0),
        "budget_exceeded", "Source receipt slot reserved for gap");
      break;
    case "gap":
      row.source_count++;
      // Only the first gap draws reserved headroom. Later gaps are ordinary bytes.
      if (row.gap_count === 0) row.gap_bytes += bytes;
      else {
        row.source_bytes += bytes;
        check(row.source_bytes <= SOURCE_BYTES, "budget_exceeded", "Cumulative source envelope budget exhausted");
      }
      row.gap_count++;
      break;
    case "final": row.terminal_bytes += bytes; break;
    case "stop": row.stop_bytes += bytes; row.stop_count++; break;
    case "ordinary-ack": row.ack_count++; break;
    case "control-ack": row.cancel_bytes += bytes; row.ack_count++; break;
    default: check(false, "invalid", "Unknown report kind");
  }
  // Final and stop have independent reservations, including full envelope overhead.
  // Ordinary control ACKs cannot spend the cancellation reserve.
  persist(store, row);
}

/** Emergency cancellation shares its byte reservation with control acknowledgements. */
export function reserveControl(store: Store, deliveryId: string, bytes: number, emergency: boolean): void {
  const row = ledger(store, deliveryId);
  charge(row, bytes);
  row.control_count++;
  if (emergency) row.cancel_bytes += bytes;
  else check(row.control_count < CONTROL_RECEIPTS, "budget_exceeded", "Last control slot reserved for cancellation");
  persist(store, row);
}
