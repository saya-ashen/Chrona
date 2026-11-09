import { constants } from "node:fs";
import { mkdir, open, rename, unlink, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { freshState, stateSchema, receiptResultSchema } from "./schema";
import type { State } from "./types";
import { compactTerminalPrompts, MAX_STATE_BYTES } from "./retention";
import { capacity, conflict } from "./errors";
export { invalid, forbidden, capacity, conflict } from "./errors";

const MAX_BYTES = MAX_STATE_BYTES;
export const STATE_FILE = "mind-v1.json";
export const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

/** One active module process owns this directory. All instances in that process share this serialization gate. */
const gates = new Map<string, { tail: Promise<unknown>; fault: Error | null }>();
export class MindStore {
  readonly path: string;
  private readonly gate: { tail: Promise<unknown>; fault: Error | null };
  constructor(readonly directory: string) {
    this.path = join(resolve(directory), STATE_FILE);
    const previous = gates.get(this.path);
    this.gate = previous ?? { tail: Promise.resolve(), fault: null };
    gates.set(this.path, this.gate);
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const work = this.gate.tail.then(async () => { if (this.gate.fault) throw this.gate.fault; return fn(); });
    this.gate.tail = work.catch(() => {});
    return work;
  }
  private async load(): Promise<State> {
    let file;
    try { file = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Fresh data only. An obsolete agenda is never silently ignored or migrated.
      for (const name of ["agenda.json", "state.json", "decisions.json"]) {
        try { await lstat(join(this.directory, name)); }
        catch (missing) { if ((missing as NodeJS.ErrnoException).code === "ENOENT") continue; throw missing; }
        throw new Error("Mind requires fresh private data; retained legacy data needs an explicit owner decision", { cause: error });
      }
      const state = freshState();
      await this.save(state);
      return state;
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_BYTES) throw new Error("Mind state must be a bounded private 0600 file");
      const bytes = await file.readFile("utf8");
      return stateSchema.parse(JSON.parse(bytes));
    } catch (error) { throw new Error("Mind state is invalid; refusing to reset or overwrite it", { cause: error }); }
    finally { await file.close(); }
  }
  private async save(state: State) {
    const parsed = stateSchema.parse(state);
    compactTerminalPrompts(parsed);
    const bytes = JSON.stringify(parsed);
    if (Buffer.byteLength(bytes) > MAX_BYTES) capacity("Mind private state is full");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    let renamed = false;
    try {
      await file.writeFile(bytes, "utf8");
      await file.sync();
      await file.close();
      await rename(temporary, this.path);
      renamed = true;
      const directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY);
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) {
      // After rename a durability error has an uncertain commit. Do not permit further effects in this process.
      if (renamed) this.gate.fault = new Error("Mind persistence outcome is unknown; restart and inspect durable state", { cause: error });
      throw error;
    } finally {
      await file.close().catch(() => {});
      if (!renamed) await unlink(temporary).catch(() => {});
    }
  }
  read(): Promise<State> { return this.serial(() => this.load()); }
  update<T>(mutate: (state: State) => T): Promise<T> {
    return this.serial(async () => {
      const state = await this.load();
      const result = mutate(state);
      state.revision++;
      await this.save(state);
      return structuredClone(result);
    });
  }
  receipt<T>(input: { scope: string; key: string; payload: unknown; now: string }, mutate: (state: State) => T): Promise<T> {
    return this.update(state => {
      const hash = digest(input.payload), previous = state.receipts.find(item => item.scope === input.scope && item.key === input.key);
      if (previous) {
        if (previous.digest !== hash) conflict("request-key was already used with different input");
        return previous.result as T;
      }
      if (state.receipts.length >= 2048) capacity("Mind receipt capacity reached; old request keys are retained to prevent replay");
      const result = mutate(state);
      state.receipts.push({ scope: input.scope, key: input.key, digest: hash, result: receiptResultSchema.parse(result), at: input.now });
      return result;
    });
  }
}
