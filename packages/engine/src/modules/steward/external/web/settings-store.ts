// Private app copy of entry-app/preferences.ts. Keep this runtime file in the release.
import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type MemoryPreferences = { provider: string | null; autoRecall: boolean; autoRetain: boolean };
const defaults: MemoryPreferences = { provider: null, autoRecall: true, autoRetain: true };
const maxBytes = 4096;
const fields = ["provider", "autoRecall", "autoRetain"] as const;
function invalid(message: string) { return Object.assign(new Error(message), { code: "invalid" }); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw invalid("Expected a settings object");
  return value as Record<string, unknown>;
}

/** Validate a strict partial update; omitted fields are preserved. */
export function memoryPreferencesPatch(value: unknown): Partial<MemoryPreferences> {
  const input = object(value), patch: Partial<MemoryPreferences> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !fields.some(field => field === key)) throw invalid("Unknown memory preference");
    const item = input[key];
    if (key === "provider") {
      if (item !== null && (typeof item !== "string" || !/^[a-z][a-z0-9-]{1,40}$/.test(item))) throw invalid("Invalid memory provider");
      patch.provider = item;
    } else {
      if (typeof item !== "boolean") throw invalid(`Invalid ${key}`);
      patch[key as "autoRecall" | "autoRetain"] = item;
    }
  }
  return patch;
}

/** Full records require all fields; partial mode returns only supplied fields. */
export function parseMemoryPreferences(value: unknown, partial?: false): MemoryPreferences;
export function parseMemoryPreferences(value: unknown, partial: true): Partial<MemoryPreferences>;
export function parseMemoryPreferences(value: unknown, partial: boolean): Partial<MemoryPreferences>;
export function parseMemoryPreferences(value: unknown, partial = false): Partial<MemoryPreferences> {
  const parsed = memoryPreferencesPatch(value);
  if (!partial && fields.some(field => !Object.hasOwn(parsed, field))) throw invalid("Incomplete memory preferences");
  return parsed;
}

export function createPreferences(dataDir: string) {
  const path = join(dataDir, "memory-preferences.json");
  let pending: Promise<unknown> = Promise.resolve();
  async function load(): Promise<MemoryPreferences> {
    let file;
    try { file = await open(path, "r"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...defaults };
      throw error;
    }
    try {
      const bytes = Buffer.alloc(maxBytes + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > maxBytes) throw invalid("Memory preferences exceed 4096 bytes");
      let value: unknown;
      try { value = JSON.parse(bytes.subarray(0, length).toString("utf8")); }
      catch { throw invalid("Invalid memory preferences JSON"); }
      return parseMemoryPreferences(value);
    } finally { await file.close(); }
  }
  function read(): Promise<MemoryPreferences> { return pending.then(load); }
  async function update(value: unknown): Promise<MemoryPreferences> {
    const patch = memoryPreferencesPatch(value);
    const result = pending.then(async () => {
      const settings = { ...await load(), ...patch };
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      const temporary = join(dataDir, `.memory-preferences-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, `${JSON.stringify(settings)}\n`, { flag: "wx", mode: 0o600 });
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      }
      return settings;
    });
    pending = result.catch(() => {});
    return result;
  }
  async function tool(args: Record<string, unknown>): Promise<MemoryPreferences> {
    const input = object(args);
    if (Reflect.ownKeys(input).some(key => key !== "settings")) throw invalid("Unknown preference tool argument");
    if (!Object.hasOwn(input, "settings")) return read();
    if (typeof input.settings !== "string" || Buffer.byteLength(input.settings) > maxBytes) throw invalid("Expected settings JSON within 4096 bytes");
    let patch: unknown;
    try { patch = JSON.parse(input.settings); }
    catch { throw invalid("Invalid settings JSON"); }
    return update(patch);
  }
  return { read, update, tool };
}
