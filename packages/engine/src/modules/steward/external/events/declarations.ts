import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Schema = { type?: "object"; required?: string[]; properties?: Record<string, { type?: string }> };
export type Declaration = { name: string; description?: string; payload?: Schema };
export type Publisher = { module: string; moduleId: string; hash: string; emits: Declaration[] };
export const MAX_DECLARATIONS_BYTES = 32 * 1024;
const NAME = /^[a-z][a-z0-9-]{1,40}$/;
const TYPES = ["string", "number", "integer", "boolean", "object", "array", "null"];
function invalid(message: string): never { throw Object.assign(new Error(`invalid: ${message}`), { code: "invalid" }); }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid("Unsupported declaration field");
}
const fieldName = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128;

function required(value: unknown) {
  if (!Array.isArray(value) || value.length > 100 || !value.every(fieldName) || new Set(value).size !== value.length)
    invalid("payload.required must contain at most 100 unique field names");
}
function properties(value: unknown) {
  if (!object(value) || Object.keys(value).length > 100) invalid("payload.properties must be an object with at most 100 fields");
  for (const [name, property] of Object.entries(value)) {
    if (!fieldName(name) || !object(property)) invalid("Invalid payload property");
    keys(property, ["type"]);
    if (property.type !== undefined && (typeof property.type !== "string" || !TYPES.includes(property.type))) invalid("Unsupported payload property type");
  }
}
/** Deliberately bounded subset: object payloads, required fields and shallow property types. */
function schema(value: unknown): asserts value is Schema {
  if (!object(value)) invalid("payload schema must be an object");
  keys(value, ["type", "required", "properties"]);
  if (value.type !== undefined && value.type !== "object") invalid("payload schema type must be object");
  if (value.required !== undefined) required(value.required);
  if (value.properties !== undefined) properties(value.properties);
}
function declarations(value: unknown): Declaration[] {
  if (!Array.isArray(value) || value.length > 20) invalid("emits must be an array of at most 20 declarations");
  const names = new Set<string>();
  for (const item of value) {
    if (!object(item)) invalid("Each declaration must be an object");
    keys(item, ["name", "description", "payload"]);
    if (typeof item.name !== "string" || !NAME.test(item.name) || names.has(item.name)) invalid("Event names must be unique own names matching [a-z][a-z0-9-]{1,40}");
    names.add(item.name);
    if (item.description !== undefined && (typeof item.description !== "string" || item.description.length > 300)) invalid("description must be a string of at most 300 characters");
    if (item.payload !== undefined) schema(item.payload);
  }
  return value as Declaration[];
}
export function parseRegistration(args: Record<string, unknown>): Declaration[] {
  keys(args, ["emits"]);
  if (typeof args.emits !== "string" || Buffer.byteLength(args.emits) > MAX_DECLARATIONS_BYTES) invalid("emits must be a JSON string of at most 32 KiB");
  let value: unknown;
  try { value = JSON.parse(args.emits); } catch { invalid("emits must be JSON"); }
  const emits = declarations(value);
  // Escaping lone surrogates can make persisted JSON larger than the received JSON string.
  if (Buffer.byteLength(JSON.stringify(emits)) > MAX_DECLARATIONS_BYTES) invalid("Serialized declarations exceed 32 KiB");
  return emits;
}

function publisher(value: unknown): Publisher {
  if (!object(value)) invalid("Invalid publisher identity");
  keys(value, ["module", "moduleId", "hash", "emits"]);
  if (typeof value.module !== "string" || !NAME.test(value.module) || typeof value.moduleId !== "string" || !value.moduleId || typeof value.hash !== "string" || !value.hash) invalid("Invalid publisher identity");
  const emits = declarations(value.emits);
  if (Buffer.byteLength(JSON.stringify(emits)) > MAX_DECLARATIONS_BYTES) invalid("Invalid stored declarations size");
  return { module: value.module, moduleId: value.moduleId, hash: value.hash, emits };
}

/** App-private declarations; legacy manifest contributions are never imported. */
export function openPublishers(dataDir: string) {
  const file = join(dataDir, "publishers.json");
  let rows: Publisher[] = [];
  let value: unknown = [];
  try { value = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!Array.isArray(value)) invalid("Invalid publishers store");
  const identities = new Set<string>();
  for (const item of value) {
    const row = publisher(item);
    if (identities.has(row.moduleId)) invalid("Duplicate publisher identity");
    identities.add(row.moduleId);
    rows.push(row);
  }
  return {
    rows: () => rows,
    save(next: Publisher[]) {
      writeFileSync(`${file}.tmp`, JSON.stringify(next)); renameSync(`${file}.tmp`, file); rows = next;
    },
  };
}
