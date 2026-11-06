import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

// v2-28: the mind's working memory (open matters) and its decision log, kept in the module's data directory.
export const STATUSES = ["watching", "acting", "waiting-user", "waiting-external", "done", "dropped"] as const;
export const ESCALATIONS = ["none", "early", "day-before", "final"] as const;
export const OUTCOMES = ["acted", "notified", "asked", "nothing"] as const;
type Status = typeof STATUSES[number];
type Escalation = typeof ESCALATIONS[number];
type Outcome = typeof OUTCOMES[number];
type Stamp = { at: string; text: string };
export type Concern = {
  id: string; title: string; goal?: string; status: Status; dueAt?: string; revisitAt?: string; escalation: Escalation;
  commitments: Stamp[]; userSignals: Stamp[]; lastAssessment?: { at: string; conclusion: string; by: "mind" | "chat" | "user" };
  source?: { moduleId: string; activationId: string; incidentId?: string; topic?: string };
  assessedRevision?: number; silentUntil?: string; declined?: { at: string; reason: string }; build?: { sessionId: string; at: string };
  createdAt: string; updatedAt: string;
};
export type Answer = { wake: number; focus: string; urgency: number };
export type Entry = {
  id: string; at: string; trigger: string; source: "intuition" | "rules" | "daily"; answer?: Answer;
  wake: boolean; focus: string; urgency: number; changes: string[]; blocked?: boolean;
  refs?: string[];
  outcome?: { kind: Outcome; summary: string; at: string; sessionId?: string; buildSessionId?: string };
};
type Args = Record<string, unknown>;
type Caller = { kind: string } | undefined;

const DAY = 86_400_000, MAX_OPEN = 200, MAX_ENTRIES = 500;
const closed = (concern: Concern) => concern.status === "done" || concern.status === "dropped";
const text = (value: unknown, max: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
class Invalid extends Error {}

function identifier(value: unknown, name: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !/^[\w:.-]{1,80}$/.test(value)) throw new Invalid(`${name} must be an id (1-80 characters: word, colon, dot, dash)`);
  return value;
}
function sourceUpdate(args: Args, existing: Concern["source"]): Concern["source"] {
  const keys = ["source-module-id", "source-activation-id", "source-incident-id", "topic"];
  if (!keys.some(key => args[key] !== undefined)) return undefined;
  const [moduleId, activationId, incidentId, topic] = keys.map(key => identifier(args[key], key));
  if (!moduleId || !activationId || Boolean(incidentId) === Boolean(topic)) throw new Invalid("source needs module, activation and exactly one incident or topic together");
  const source = { moduleId, activationId, ...(incidentId ? { incidentId } : { topic }) };
  if (existing && JSON.stringify(existing) !== JSON.stringify(source)) throw new Invalid("source cannot be changed once set");
  return source;
}

function validRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function time(value: unknown, name: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === "" || value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Invalid(`${name} must be an ISO time or empty`);
  return new Date(value).toISOString();
}
function pick<T extends string>(value: unknown, options: readonly T[], name: string): T | undefined {
  if (value === undefined) return undefined;
  if (!options.includes(value as T)) throw new Invalid(`${name} must be one of ${options.join(", ")}`);
  return value as T;
}

function updateMatter(concern: Concern, args: Args) {
  const status = pick(args.status, STATUSES, "status"), escalation = pick(args.escalation, ESCALATIONS, "escalation");
  if (escalation && ESCALATIONS.indexOf(escalation) < ESCALATIONS.indexOf(concern.escalation)) throw new Invalid(`escalation only rises (now ${concern.escalation})`);
  for (const key of ["title", "goal"] as const) {
    const value = text(args[key], 120);
    if (value) concern[key] = value;
  }
  if (status) concern.status = status;
  if (escalation) concern.escalation = escalation;
  for (const [arg, key] of [["due-at", "dueAt"], ["revisit-at", "revisitAt"]] as const) {
    const value = time(args[arg], arg);
    if (value !== undefined) { if (value) concern[key] = value; else delete concern[key]; }
  }
}
function updateHistory(concern: Concern, args: Args, nowIso: string, caller: Caller) {
  const by = caller?.kind === "owner" ? "user" as const : text(args["wake-id"], 40) ? "mind" as const : "chat" as const;
  const conclusion = text(args.conclusion, 300), commitment = text(args.commitment, 200), signal = text(args["user-signal"], 200);
  if (conclusion) concern.lastAssessment = { at: nowIso, conclusion, by };
  if (commitment) concern.commitments = [...concern.commitments, { at: nowIso, text: commitment }].slice(-20);
  if (signal) concern.userSignals = [...concern.userSignals, { at: nowIso, text: signal }].slice(-10);
}
function healthUpdate(args: Args, concern: Concern, at: string): Partial<Concern> {
  const update: Partial<Concern> = {};
  const source = sourceUpdate(args, concern.source);
  if (source) update.source = source;
  if (args["assessed-revision"] !== undefined) {
    const revision = args["assessed-revision"];
    if (!validRevision(revision)) throw new Invalid("assessed-revision must be a nonnegative integer");
    update.assessedRevision = revision;
  }
  if (args["silent-until"] !== undefined) update.silentUntil = time(args["silent-until"], "silent-until") ?? undefined;
  if (args.declined !== undefined) {
    if (typeof args.declined !== "string") throw new Invalid("declined must be reason text or empty");
    const reason = text(args.declined, 300);
    update.declined = reason ? { at, reason } : undefined;
  }
  if (args["build-session-id"] !== undefined) {
    const sessionId = identifier(args["build-session-id"], "build-session-id");
    update.build = sessionId ? { sessionId, at } : undefined;
  }
  return update;
}

export function createAgenda(dir: string) {
  async function read<T>(name: string, fallback: T): Promise<T> {
    try { return JSON.parse(await readFile(join(dir, name), "utf8")) as T; } catch { return fallback; }
  }
  async function write(name: string, value: unknown) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${name}.tmp`), JSON.stringify(value));
    await rename(join(dir, `${name}.tmp`), join(dir, name));
  }
  const concerns = () => read<Concern[]>("agenda.json", []);
  const entries = () => read<Entry[]>("decisions.json", []);

  async function update(fn: (list: Concern[]) => boolean) {
    const list = await concerns();
    if (fn(list)) await write("agenda.json", list);
    return list;
  }
  async function log(entry: Entry) { await write("decisions.json", [...await entries(), entry].slice(-MAX_ENTRIES)); }
  /** Wakes of the last 7 days and what they led to; the intuition and the page see the same numbers. */
  async function stats(now: number) {
    const wakes = (await entries()).filter(entry => entry.wake && !entry.blocked && now - Date.parse(entry.at) < 7 * DAY);
    const useful = wakes.filter(entry => entry.outcome && entry.outcome.kind !== "nothing").length, nothing = wakes.filter(entry => entry.outcome?.kind === "nothing").length;
    return { wakes7d: wakes.length, useful7d: useful, nothing7d: nothing, unreported7d: wakes.length - useful - nothing, lastWake: wakes.at(-1) ?? null };
  }

  async function note(args: Args, nowIso: string, caller: Caller) {
    const list = await concerns(), now = Date.parse(nowIso);
    const id = text(args.id, 40), existing = id ? list.find(concern => concern.id === id) : undefined;
    if (id && !existing) throw new Invalid(`No concern ${id}`);
    const title = text(args.title, 120);
    if (!existing && !title) throw new Invalid("A new concern needs a title");
    if (!existing && list.filter(concern => !closed(concern)).length >= MAX_OPEN) throw new Invalid(`At most ${MAX_OPEN} open concerns; close finished ones first`);
    // Mutate the existing object: older writers must retain unknown additive fields.
    const concern: Concern = existing ?? { id: `c-${randomUUID().slice(0, 8)}`, title: title!, status: "watching", escalation: "none", commitments: [], userSignals: [], createdAt: nowIso, updatedAt: nowIso };
    const health = healthUpdate(args, concern, nowIso);
    updateMatter(concern, args);
    updateHistory(concern, args, nowIso, caller);
    Object.assign(concern, health);
    for (const [key, value] of Object.entries(health as Record<string, unknown>)) if (value === undefined) delete concern[key as keyof Concern];
    concern.updatedAt = nowIso;
    // Closed matters stay visible for 30 days, then go.
    const kept = list.filter(item => item !== existing && !(closed(item) && now - Date.parse(item.updatedAt) > 30 * DAY));
    await write("agenda.json", [...kept, concern]);
    return { concern };
  }
  async function report(args: Args, nowIso: string) {
    const wakeId = text(args["wake-id"], 40), kind = pick(args.outcome, OUTCOMES, "outcome"), summary = text(args.summary, 300);
    if (!wakeId || !kind || !summary) throw new Invalid("wake-id, outcome and summary are required");
    const list = await entries(), entry = list.find(item => item.id === wakeId && item.wake && !item.blocked);
    if (!entry) throw new Invalid(`No wake ${wakeId}`);
    const sessionId = identifier(args["session-id"], "session-id"), buildSessionId = identifier(args["build-session-id"], "build-session-id");
    entry.outcome = { kind, summary, at: nowIso, ...(sessionId ? { sessionId } : {}), ...(buildSessionId ? { buildSessionId } : {}) };
    await write("decisions.json", list);
    return { ok: true as const };
  }
  async function tool(name: string, args: Args, nowIso: string, caller: Caller): Promise<unknown> {
    try {
      if (name === "agenda") return { now: nowIso, concerns: (await concerns()).filter(concern => args.all === true || !closed(concern)) };
      if (name === "note") return await note(args, nowIso, caller);
      if (name === "report") return await report(args, nowIso);
      if (name === "decisions") {
        const limit = Math.min(100, Math.max(1, typeof args.limit === "number" ? Math.floor(args.limit) : 20));
        return { entries: (await entries()).slice(-limit).reverse(), stats: await stats(Date.parse(nowIso)) };
      }
      return { error: `Unknown tool ${name}` };
    } catch (error) {
      if (error instanceof Invalid) return { error: error.message };
      throw error;
    }
  }
  return { concerns, entries, update, log, stats, tool, read, write };
}
