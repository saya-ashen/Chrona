import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { EXECUTOR_LIMITS, executorSourceRecordSchema, type ExecutorSourceRecord } from "@chrona/contracts/steward";
import { ExecutorJournal, localDigest } from "./journal";

const spoolSchema = z.object({ version: z.literal(1), unit: z.string(), produced: z.number().int().nonnegative(), ack: z.number().int().nonnegative(), records: z.array(executorSourceRecordSchema).max(EXECUTOR_LIMITS.sourceReceipts) }).strict();
type Spool = z.infer<typeof spoolSchema>;
/** One daemon writer, synchronous durable append before HTTP; final lives in independently reserved journal. */
export class ExecutorSpool {
  constructor(readonly journal: ExecutorJournal) {}
  private path(unit: string) {
    if (!/^chrona-executor-[a-f0-9]{64}\.service$/.test(unit)) throw new Error("Invalid spool unit");
    return join(this.journal.directory, `${unit}.spool`);
  }
  read(unit: string): Spool {
    const path = this.path(unit), stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat) return { version: 1, unit, produced: 0, ack: 0, records: [] };
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.size > EXECUTOR_LIMITS.spoolBytes) throw new Error("Unsafe source spool");
    const value = spoolSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    if (value.unit !== unit || value.ack > value.produced) throw new Error("Invalid source spool");
    validateSpoolRecords(value);
    return value;
  }
  private save(value: Spool) {
    const path = this.path(value.unit), body = JSON.stringify(value), bytes = Buffer.byteLength(body);
    let total = bytes, active = 0;
    for (const name of readdirSync(this.journal.directory)) {
      const file = join(this.journal.directory, name), stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error("Unsafe device spool entry");
      if (!stat.isFile()) continue;
      if (file !== path) total += stat.size;
      if (name.endsWith(".spool") && !this.journal.read(name.slice(0, -6))?.ack?.stopConfirmed) active++;
    }
    active += Number(!lstatSync(path, { throwIfNoEntry: false }));
    if (bytes > EXECUTOR_LIMITS.spoolBytes || total > EXECUTOR_LIMITS.deviceSpoolBytes - 2 * EXECUTOR_LIMITS.terminalBytes || active > EXECUTOR_LIMITS.codingEnvironment) throw new Error("Device source capacity reached");
    const fd = openSync(`${path}.next`, "wx", 0o600);
    try { writeFileSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(`${path}.next`, path);
    const directory = openSync(this.journal.directory, "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
  retire(now: Date) {
    for (const name of readdirSync(this.journal.directory).filter(file => file.endsWith(".spool"))) {
      const unit = name.slice(0, -6), value = this.journal.read(unit);
      if (!value?.ack?.stopConfirmed || Date.parse(value.ack.at) + 30 * 86400000 > now.getTime()) continue;
      this.read(unit); // Validate the exact owned spool before retiring details, never identity/final tombstones.
      unlinkSync(this.path(unit));
    }
    const directory = openSync(this.journal.directory, "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
  reserve(unit: string) { this.save(this.read(unit)); }
  append(unit: string, item: ExecutorSourceRecord["item"], at = new Date().toISOString()) {
    const value = this.read(unit), sourceSeq = value.produced + 1;
    let body = { sourceSeq, at, item };
    let record = { ...body, digest: localDigest(body) };
    if (!executorSourceRecordSchema.safeParse(record).success || value.records.length >= EXECUTOR_LIMITS.sourceReceipts - 1 || Buffer.byteLength(JSON.stringify(value)) > EXECUTOR_LIMITS.spoolBytes - 2 * EXECUTOR_LIMITS.recordBytes) {
      const last = value.records.at(-1);
      if (last?.item.kind === "gap") throw new Error("Source spool sealed after gap");
      body = { sourceSeq, at, item: { kind: "gap", throughSourceSeq: sourceSeq, reason: "backpressure" } };
      record = { ...body, digest: localDigest(body) };
    }
    value.produced = record.item.kind === "gap" ? record.item.throughSourceSeq : sourceSeq; value.records.push(record);
    this.save(value);
    return record.item.kind === "gap";
  }
  batch(unit: string) {
    const records: ExecutorSourceRecord[] = [];
    let bytes = 2;
    for (const record of this.read(unit).records) {
      const size = Buffer.byteLength(JSON.stringify(record)) + 1;
      if (records.length >= EXECUTOR_LIMITS.records || bytes + size > EXECUTOR_LIMITS.eventBytes) break;
      records.push(record); bytes += size;
    }
    return records;
  }
  acknowledge(unit: string, through: number) {
    const value = this.read(unit);
    if (through < value.ack || through > value.produced || !Number.isSafeInteger(through)) throw new Error("Invalid source acknowledgement");
    if (through !== value.ack && !value.records.some(row => (row.item.kind === "gap" ? row.item.throughSourceSeq : row.sourceSeq) === through)) throw new Error("Acknowledgement splits source record");
    value.ack = through; value.records = value.records.filter(row => row.sourceSeq > through); this.save(value);
  }
}


function validateSpoolRecords(value: Spool) {
    let through = value.ack;
    for (const raw of value.records) {
      const record = raw, { digest, ...body } = record;
      if (digest !== localDigest(body) || record.sourceSeq !== through + 1) throw new Error("Source spool sequence mismatch");
      through = record.item.kind === "gap" ? record.item.throughSourceSeq : record.sourceSeq;
    }
    if (through !== value.produced) throw new Error("Source spool watermark mismatch");
}
