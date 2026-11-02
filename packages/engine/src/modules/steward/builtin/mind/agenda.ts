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
  createdAt: string; updatedAt: string;
};
export type Answer = { wake: number; focus: string; urgency: number };
export type Entry = {
  id: string; at: string; trigger: string; source: "intuition" | "rules" | "daily"; answer?: Answer;
  wake: boolean; focus: string; urgency: number; changes: string[]; blocked?: boolean;
  outcome?: { kind: Outcome; summary: string; at: string };
};
type Args = Record<string, unknown>;
type Caller = { kind: string } | undefined;

const DAY = 86_400_000, MAX_OPEN = 200, MAX_ENTRIES = 500;
const closed = (concern: Concern) => concern.status === "done" || concern.status === "dropped";
const text = (value: unknown, max: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
class Invalid extends Error {}

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

  async function log(entry: Entry) { await write("decisions.json", [...await entries(), entry].slice(-MAX_ENTRIES)); }
  /** Wakes of the last 7 days and what they led to; the intuition and the page see the same numbers. */
  async function stats(now: number) {
    const wakes = (await entries()).filter(entry => entry.wake && !entry.blocked && now - Date.parse(entry.at) < 7 * DAY);
    const useful = wakes.filter(entry => entry.outcome && entry.outcome.kind !== "nothing").length, nothing = wakes.filter(entry => entry.outcome?.kind === "nothing").length;
    return { wakes7d: wakes.length, useful7d: useful, nothing7d: nothing, unreported7d: wakes.length - useful - nothing, lastWake: wakes.at(-1) ?? null };
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
  async function note(args: Args, nowIso: string, caller: Caller) {
    const list = await concerns(), now = Date.parse(nowIso);
    const id = text(args.id, 40), existing = id ? list.find(concern => concern.id === id) : undefined;
    if (id && !existing) throw new Invalid(`No concern ${id}`);
    const title = text(args.title, 120);
    if (!existing && !title) throw new Invalid("A new concern needs a title");
    if (!existing && list.filter(concern => !closed(concern)).length >= MAX_OPEN) throw new Invalid(`At most ${MAX_OPEN} open concerns; close finished ones first`);
    const status = pick(args.status, STATUSES, "status"), escalation = pick(args.escalation, ESCALATIONS, "escalation");
    if (escalation && existing && ESCALATIONS.indexOf(escalation) < ESCALATIONS.indexOf(existing.escalation)) throw new Invalid(`escalation only rises (now ${existing.escalation})`);
    const dueAt = time(args["due-at"], "due-at"), revisitAt = time(args["revisit-at"], "revisit-at");
    const by = caller?.kind === "owner" ? "user" as const : text(args["wake-id"], 40) ? "mind" as const : "chat" as const;
    const concern: Concern = existing ?? { id: `c-${randomUUID().slice(0, 8)}`, title: title!, status: "watching", escalation: "none", commitments: [], userSignals: [], createdAt: nowIso, updatedAt: nowIso };
    if (title) concern.title = title;
    const goal = text(args.goal, 120);
    if (goal) concern.goal = goal;
    if (status) concern.status = status;
    if (escalation) concern.escalation = escalation;
    if (dueAt !== undefined) { if (dueAt) concern.dueAt = dueAt; else delete concern.dueAt; }
    if (revisitAt !== undefined) { if (revisitAt) concern.revisitAt = revisitAt; else delete concern.revisitAt; }
    const conclusion = text(args.conclusion, 300), commitment = text(args.commitment, 200), signal = text(args["user-signal"], 200);
    if (conclusion) concern.lastAssessment = { at: nowIso, conclusion, by };
    if (commitment) concern.commitments = [...concern.commitments, { at: nowIso, text: commitment }].slice(-20);
    if (signal) concern.userSignals = [...concern.userSignals, { at: nowIso, text: signal }].slice(-10);
    concern.updatedAt = nowIso;
    // Closed matters stay visible for 30 days, then go.
    const kept = list.filter(item => item.id !== concern.id && !(closed(item) && now - Date.parse(item.updatedAt) > 30 * DAY));
    await write("agenda.json", [...kept, concern]);
    return { concern };
  }
  async function report(args: Args, nowIso: string) {
    const wakeId = text(args["wake-id"], 40), kind = pick(args.outcome, OUTCOMES, "outcome"), summary = text(args.summary, 300);
    if (!wakeId || !kind || !summary) throw new Invalid("wake-id, outcome and summary are required");
    const list = await entries(), entry = list.find(item => item.id === wakeId && item.wake && !item.blocked);
    if (!entry) throw new Invalid(`No wake ${wakeId}`);
    entry.outcome = { kind, summary, at: nowIso };
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
  return { concerns, entries, log, stats, tool, read, write };
}
