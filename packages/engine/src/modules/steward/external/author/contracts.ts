/** Ordinary application contracts. None of these values confer kernel authority. */
export class AuthorError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export const fail = (message: string): never => { throw new AuthorError("invalid", message); };
export type Intent = { changes: string[]; preserves: string[] };
export type Target = { name: string; moduleId: string | null; expectedActiveHash: string | null };
export type Prepare = { requestKey: string; submitter: { moduleId: string; hash: string }; targets: Target[]; goal: string; intent: Intent };
export type Submit = { admissionId: string; requestKey: string; items: { name: string; dir: string; intent: Intent }[] };
export type Source = { admissionId: string; moduleId: string; hash: string; to: string };
export type Receipt = { receiptId: string } | { admissionId: string; requestKey: string };
export type Provenance = { kind: "local"; label: string } | { kind: "kernel-source"; moduleId: string; hash: string; ref: string; materialDigest: string };
export type Stage = { name: string; from: string; to: string; provenance: Provenance };
export function object(value: unknown, keys: string[], required = keys): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("Expected an object.");
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(result, key))) return fail("Unexpected or missing fields.");
  return result;
}
function hasControl(value: string, allowWhitespace = false): boolean {
  return Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return (code < 32 || code === 127) && !(allowWhitespace && [9, 10, 13].includes(code));
  });
}
export function text(value: unknown, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || hasControl(value, true)) return fail("Expected bounded text.");
  return value;
}
export function name(value: unknown): string {
  const result = text(value, 41);
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(result) || result === "agent") return fail("Expected an ordinary application name.");
  return result;
}
export function hash(value: unknown): string {
  const result = text(value, 64);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(result)) return fail("Expected an immutable version hash.");
  return result;
}
export function intent(value: unknown): Intent {
  const row = object(value, ["changes", "preserves"], ["changes"]);
  const lines = (value: unknown, min: number) => {
    if (!Array.isArray(value) || value.length < min || value.length > 20) return fail("Expected bounded intent lines.");
    return value.map(line => text(line, 500).trim());
  };
  return { changes: lines(row.changes, 1), preserves: lines(row.preserves ?? [], 0) };
}
function group<T>(value: unknown, parse: (value: unknown) => T & { name: string }): T[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return fail("Expected one to four complete targets.");
  const rows = value.map(parse);
  if (new Set(rows.map(row => row.name)).size !== rows.length) return fail("Target names must be unique.");
  return rows;
}
export function relative(value: unknown): string {
  const result = text(value, 4096);
  const parts = result.split("/");
  if (result.includes("\\") || result.includes(":") || hasControl(result) || parts.some(part => !part || part === "." || part === ".." || part === ".git")) return fail("Expected a safe relative source path.");
  return result;
}
export function sourceDir(value: unknown): string {
  const result = relative(value);
  if (!/^sources\/[a-z][a-z0-9-]{0,63}$/.test(result)) return fail("Expected sources/<workspace>.");
  return result;
}
export function submitDir(value: unknown): string {
  const result = relative(value);
  if (!/^sources\/[a-z][a-z0-9-]{0,63}$/.test(result) && !/^packages\/[a-z][a-z0-9-]{0,63}\/source$/.test(result)) return fail("Expected an own source workspace or staged package source.");
  return result;
}
export function parsePrepare(value: unknown): Prepare {
  const row = object(value, ["requestKey", "submitter", "targets", "goal", "intent"]);
  const submitter = object(row.submitter, ["moduleId", "hash"]);
  const targets = group<Target>(row.targets, value => {
    const row = object(value, ["name", "moduleId", "expectedActiveHash"]);
    if ((row.moduleId === null) !== (row.expectedActiveHash === null)) return fail("An update requires both module identity and active hash.");
    return { name: name(row.name), moduleId: row.moduleId === null ? null : text(row.moduleId), expectedActiveHash: row.expectedActiveHash === null ? null : hash(row.expectedActiveHash) };
  });
  const ids = targets.flatMap(target => target.moduleId === null ? [] : [target.moduleId]);
  if (new Set(ids).size !== ids.length) return fail("Target identities must be unique.");
  return { requestKey: text(row.requestKey), submitter: { moduleId: text(submitter.moduleId), hash: hash(submitter.hash) }, targets, goal: text(row.goal, 8000), intent: intent(row.intent) };
}
export function parseSubmit(value: unknown): Submit {
  const row = object(value, ["admissionId", "requestKey", "items"]);
  const items = group<Submit["items"][number]>(row.items, value => {
    const row = object(value, ["name", "dir", "intent"]);
    return { name: name(row.name), dir: submitDir(row.dir), intent: intent(row.intent) };
  });
  if (new Set(items.map(item => item.dir)).size !== items.length) return fail("Each member needs its own material directory.");
  return { admissionId: text(row.admissionId), requestKey: text(row.requestKey), items };
}
export function parseSource(value: unknown): Source {
  const row = object(value, ["admissionId", "moduleId", "hash", "to"]);
  return { admissionId: text(row.admissionId), moduleId: text(row.moduleId), hash: hash(row.hash), to: sourceDir(row.to) };
}
export function parseReceipt(value: unknown): Receipt {
  if (value && typeof value === "object" && "receiptId" in value) {
    const row = object(value, ["receiptId"]);
    return { receiptId: text(row.receiptId) };
  }
  const row = object(value, ["admissionId", "requestKey"]);
  return { admissionId: text(row.admissionId), requestKey: text(row.requestKey) };
}
export function parseStage(value: unknown): Stage {
  const row = object(value, ["name", "from", "to", "provenance"]);
  const to = relative(row.to);
  if (!/^packages\/[a-z][a-z0-9-]{0,63}$/.test(to)) return fail("Expected packages/<stage>.");
  let provenance: Provenance;
  if (row.provenance && typeof row.provenance === "object" && "kind" in row.provenance && row.provenance.kind === "local") {
    const p = object(row.provenance, ["kind", "label"]);
    provenance = { kind: "local", label: text(p.label, 300) };
  } else {
    const p = object(row.provenance, ["kind", "moduleId", "hash", "ref", "materialDigest"]);
    if (p.kind !== "kernel-source") return fail("Expected local or kernel-source provenance.");
    provenance = { kind: "kernel-source", moduleId: text(p.moduleId), hash: hash(p.hash), ref: text(p.ref, 300), materialDigest: hash(p.materialDigest) };
  }
  return { name: name(row.name), from: submitDir(row.from), to, provenance };
}
export function jsonInput(args: Record<string, unknown>, max = 24000): unknown {
  object(args, ["input"]);
  const input = text(args.input, max);
  try { return JSON.parse(input); } catch { return fail("Expected JSON input."); }
}
export function integer(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) return fail("Expected a bounded nonnegative integer.");
  return value as number;
}
