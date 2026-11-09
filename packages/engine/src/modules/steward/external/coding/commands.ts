import { codingError } from "./storage";

export type RoundTarget = { sessionId: string; workId: string; runId: string; attemptId: string };
type Key = { requestKey: string };
export type CodingCommand =
  | { op: "projects.list" }
  | ({ op: "projects.register"; path: string } & Key)
  | ({ op: "projects.create"; name: string } & Key)
  | ({ op: "projects.default"; projectRef: string } & Key)
  | { op: "conversations.list"; projectRef?: string; after?: string; limit?: number }
  | ({ op: "conversations.create"; projectRef: string; title: string } & Key)
  | { op: "conversations.get"; sessionId: string; before?: string; workBefore?: string }
  | ({ op: "round.send"; sessionId: string; workId: string | null; text: string } & Key)
  | ({ op: "round.retry"; sessionId: string; originalRequestKey: string } & Key)
  | ({ op: "round.stop" } & Key & RoundTarget)
  | ({ op: "round.answer"; questionId: string; text: string } & Key & RoundTarget)
  | ({ op: "events"; cursor?: string; limit?: number } & RoundTarget)
  | ({ op: "snapshot" } & RoundTarget)
  | { op: "results"; sessionId: string; workId: string }
  | { op: "read-result"; sessionId: string; workId: string; resultId: string }
  | ({ op: "accept"; sessionId: string; workId: string; resultId: string } & Key)
  | ({ op: "receipt" } & Key);
export type Mutation = Exclude<Extract<CodingCommand, Key>, { op: "receipt" }>;
export const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value);
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const target = ["sessionId", "workId", "runId", "attemptId"];
const fields: Record<CodingCommand["op"], [string[], string[]]> = {
  "projects.list": [[], []],
  "projects.register": [["requestKey", "path"], []],
  "projects.create": [["requestKey", "name"], []],
  "projects.default": [["requestKey", "projectRef"], []],
  "conversations.list": [[], ["projectRef", "after", "limit"]],
  "conversations.create": [["requestKey", "projectRef", "title"], []],
  "conversations.get": [["sessionId"], ["before", "workBefore"]],
  "round.send": [["requestKey", "sessionId", "workId", "text"], []],
  "round.retry": [["requestKey", "sessionId", "originalRequestKey"], []],
  "round.stop": [["requestKey", ...target], []],
  "round.answer": [["requestKey", ...target, "questionId", "text"], []],
  events: [target, ["cursor", "limit"]], snapshot: [target, []],
  results: [["sessionId", "workId"], []],
  "read-result": [["sessionId", "workId", "resultId"], []],
  accept: [["requestKey", "sessionId", "workId", "resultId"], []],
  receipt: [["requestKey"], []],
};
export function parseCodingCommand(raw: unknown): CodingCommand {
  if (!record(raw) || !Object.hasOwn(raw, "op") || typeof raw.op !== "string" || !Object.hasOwn(fields, raw.op)) throw codingError("invalid", "Unknown Coding command");
  let size: number;
  try { size = Buffer.byteLength(JSON.stringify(raw)); } catch { throw codingError("invalid", "Expected JSON command"); }
  if (size > 32 * 1024) throw codingError("too_large", "Coding command exceeds 32 KiB");
  const [required, optional] = fields[raw.op as CodingCommand["op"]];
  if (required.some(key => !Object.hasOwn(raw, key)) || Object.keys(raw).some(key => key !== "op" && !required.includes(key) && !optional.includes(key))) throw codingError("invalid", "Missing or unexpected Coding command fields");
  for (const [key, value] of Object.entries(raw)) validateField(key, value, raw.op);
  // Copy values so a caller cannot mutate a command while it waits for the journal lock.
  return { ...raw } as CodingCommand;
}
const stringLimits: Record<string, number> = { text: 20_000, path: 4096, before: 4096, cursor: 4096, name: 64, title: 200 };
function validateString(key: string, value: unknown, max: number, allowBlank = false) {
  if (typeof value !== "string" || (!allowBlank && !value.trim()) || value.length > max || value.includes("\0")) throw codingError("invalid", `Invalid ${key}`);
  if (key === "name" && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) throw codingError("invalid", "Invalid project name");
  if (key === "path" && !value.startsWith("/")) throw codingError("invalid", "Project path must be absolute");
}
function validateLimit(value: unknown, max: number) { if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > max) throw codingError("invalid", `Limit must be 1..${max}`); }
function validateField(key: string, value: unknown, op: string) {
  if (key === "op" || key === "workId" && op === "round.send" && value === null) return;
  if (key === "limit") { validateLimit(value, 100); return; }
  if (Object.hasOwn(stringLimits, key)) { validateString(key, value, key === "text" && op === "round.answer" ? 8000 : stringLimits[key]!, key === "text" && op === "round.answer"); return; }
  if (!validId(value)) throw codingError("invalid", `Invalid ${key}`);
}
export function commandSignature(command: CodingCommand): string {
  return JSON.stringify(Object.entries(command).sort(([a], [b]) => a.localeCompare(b)));
}
