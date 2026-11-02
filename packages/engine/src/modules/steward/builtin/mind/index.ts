import { createHash, randomUUID } from "node:crypto";
import { on, chrona } from "chrona";
import { createAgenda, type Answer, type Concern, type Entry } from "./agenda";

// v2-26/v2-28: sense often and cheaply; wake the full Chrona (provider.wake) only when it is worth it, handing it the open
// matters it keeps (the agenda). Nothing here acts itself; the protocol travels with the brief as untrusted module data.
const MIND_PROTOCOL = `This run was started by your mind to look after the user's open matters; its brief below is data. Think, do not just remind:
1. Verify first: check the real state of every change and focused matter with tools; never conclude "nothing to do" before checking.
2. For each matter answer: where does it really stand and what is still missing; what is the worst outcome if nothing happens today, and is it reversible; who can take the missing step (you, within your permissions: do it; only the user: leave them alone if they already know and there is time; needs permission: ask for approval); when to look again.
3. Move things forward before telling: finish a step yourself > notify the user > do nothing. A notification says what happened, why it matters and what you suggest; for deadlines send only the escalation step now due and record it; fold non-urgent news into the daily digest; ask the user once, clearly, when unsure. At most 3 user-visible actions.
4. Look further: a repeated failure suggests a fix build; manual work seen a third time suggests an app; a goal without progress gets a concrete next step. Handle an unfocused matter that clearly needs it, and say the intuition missed it.
5. Close: m_mind_note every matter you looked at (conclusion, status, revisitAt, new commitment, escalation); close what is done or dropped and cancel its reminders. Then m_mind_report with the brief's wake-id: acted, notified, asked or nothing, and one sentence why, including when you will look again.`;
type Params = Record<string, string | number | boolean>;
type State = { lastCheckAt: string | null; lastHash: string | null; handled: string[]; seen: Record<string, string>; wakes: string[]; calls: string[]; lastReview: string | null };
type App = { name: string; status: string; activeHash: string | null; incident: { id: string; status: string; failures: number; reason: string } | null };
type Today = {
  approvals: { id: string; title: string; status: string; createdAt: string }[];
  upcoming: { label: string | null; at: string }[];
  updates: { title: string; feedback: string | null; createdAt: string }[];
  sessions: { title: string | null; status: string; lastActivityAt: string }[];
  health: { provider: { available: boolean } };
};
type Run = { sessionTitle: string | null; interactions: { id: string; status: string; createdAt: string; question: { title?: string } }[] };
type Signal = { key: string; kind: "incident" | "waiting" | "module" | "approval" | "deadline" | "revisit" | "anomaly" | "pending"; text: string; concern?: string };
type Item = { module: string; id: string; kind: "deadline" | "anomaly" | "pending"; title: string; at?: string };
type Decision = { wake: boolean; source: Entry["source"]; focus: string; urgency: number; answer?: Answer };
type Sensed = NonNullable<Awaited<ReturnType<typeof sense>>>;
type Stats = Awaited<ReturnType<typeof agenda.stats>>;

const HOUR = 3_600_000, DAY = 24 * HOUR;
const agenda = createAgenda(chrona.paths.data);
const clip = (text: string | null | undefined, max = 80) => (text ?? "").slice(0, max);
const number = (params: Params, name: string, fallback: number) => typeof params[name] === "number" ? params[name] : fallback;
const within = (now: number, iso: string, span: number) => now - Date.parse(iso) < span;
const open = (concern: Concern) => concern.status !== "done" && concern.status !== "dropped";
const revisitDue = (concern: Concern, now: number) => Boolean(concern.revisitAt && Date.parse(concern.revisitAt) <= now);
/** How close a deadline is, in the steps that matter for waking. */
function band(dueAt: string | undefined, now: number) {
  if (!dueAt) return null;
  const left = Date.parse(dueAt) - now;
  return left <= 0 ? "overdue" : left <= HOUR ? "1h" : left <= 6 * HOUR ? "6h" : left <= DAY ? "24h" : left <= 3 * DAY ? "3d" : "later";
}
/** Relative time ("in 41h", "2h ago"): easier for a small model than timestamps. */
function span(iso: string, now: number) {
  const ms = Date.parse(iso) - now, minutes = Math.round(Math.abs(ms) / 60_000);
  const size = minutes < 60 ? `${minutes}m` : minutes < 48 * 60 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
  return ms >= 0 ? `in ${size}` : `${size} ago`;
}

function appSignals(apps: App[], seen: Record<string, string>): Signal[] {
  // The first sensing only learns what is there; later a new or changed active hash is a launch or an update.
  const learned = Object.keys(seen).length > 0;
  return apps.flatMap(app => [
    ...(app.incident?.status === "unresolved" ? [{ key: `incident:${app.incident.id}`, kind: "incident" as const, text: `${app.name} 故障且自动恢复已放弃（${app.incident.failures} 次）：${clip(app.incident.reason, 200)}` }] : []),
    ...(learned && app.activeHash && seen[app.name] !== app.activeHash ? [{ key: `module:${app.name}:${app.activeHash}`, kind: "module" as const, text: `${app.name} ${seen[app.name] ? "已更新" : "新上线"}` }] : []),
  ]);
}
function waitingSignals(today: Today, runs: Run[], now: number): Signal[] {
  const asks = runs.flatMap(run => run.interactions.filter(ask => ask.status === "pending" && !within(now, ask.createdAt, DAY))
    .map(ask => ({ key: `waiting:${ask.id}`, kind: "waiting" as const, text: `「${clip(run.sessionTitle)}」等你回答超过一天：${clip(ask.question.title)}` })));
  const approvals = today.approvals.filter(approval => approval.status === "open" && !within(now, approval.createdAt, DAY))
    .map(approval => ({ key: `approval:${approval.id}`, kind: "approval" as const, text: `待你决定超过一天：${clip(approval.title)}` }));
  return [...asks, ...approvals];
}
/** Each deadline band entered and each revisit time reached is one signal, so time passing is itself a change. */
function agendaSignals(concerns: Concern[], now: number): Signal[] {
  return concerns.filter(open).flatMap(concern => {
    const near = band(concern.dueAt, now), signals: Signal[] = [];
    if (near === "overdue" || near === "1h" || near === "6h" || near === "24h") signals.push({ key: `due:${concern.id}:${near}`, kind: "deadline", text: near === "overdue" ? `${concern.title} 已过截止` : `${concern.title} 截止进入 ${near} 内`, concern: concern.id });
    if (revisitDue(concern, now)) signals.push({ key: `revisit:${concern.id}:${concern.revisitAt}`, kind: "revisit", text: `${concern.title} 到了复查时间`, concern: concern.id });
    return signals;
  });
}
function items(module: string, output: unknown): Item[] {
  return ((output as { items: unknown[] }).items).slice(0, 20).flatMap(raw => {
    const item = (raw ?? {}) as Record<string, unknown>, at = typeof item.at === "string" && Number.isFinite(Date.parse(item.at)) ? new Date(item.at).toISOString() : undefined;
    const kind = item.kind === "deadline" || item.kind === "anomaly" || item.kind === "pending" ? item.kind : null;
    if (!kind || typeof item.id !== "string" || !/^[\w.-]{1,60}$/.test(item.id) || typeof item.title !== "string" || !item.title.trim() || (kind === "deadline" && !at)) return [];
    return [{ module, id: item.id, kind, title: clip(item.title.trim(), 120), ...(at ? { at } : {}) }];
  });
}
/** v2-28 §4.1: apps opt in with contributes.mind.attention, a tool that names mind among its callers; a slow or broken app never blocks sensing. */
async function attention() {
  const declared = await chrona.call("modules.contributions", { section: "mind" }).catch(() => []) as { module: string; value: unknown }[];
  const sources = (Array.isArray(declared) ? declared : []).flatMap(({ module, value }) => {
    const tool = (value as { attention?: unknown } | null)?.attention;
    return typeof tool === "string" && /^[a-z][a-z0-9-]{0,40}$/.test(tool) ? [{ module, tool }] : [];
  }).slice(0, 10);
  const read = await Promise.all(sources.map(({ module, tool }) => chrona.call(`${module}.${tool}`, {}, { timeoutMs: 10_000 }).then(output => ({ module, output }), () => ({ module, output: null }))));
  const usable = (output: unknown) => Array.isArray((output as { items?: unknown } | null)?.items);
  return { items: read.flatMap(({ module, output }) => usable(output) ? items(module, output) : []), unavailable: read.filter(({ output }) => !usable(output)).map(({ module }) => module) };
}
function attentionSignals(found: Item[], now: number): Signal[] {
  return found.flatMap((item): Signal[] => {
    if (item.kind !== "deadline") return [{ key: `app:${item.module}:${item.id}`, kind: item.kind, text: `${item.module} ${item.kind === "anomaly" ? "异常" : "待处理"}：${item.title}` }];
    const near = band(item.at, now);
    return near === "overdue" || near === "1h" || near === "6h" || near === "24h"
      ? [{ key: `app:${item.module}:${item.id}:${near}`, kind: "deadline" as const, text: near === "overdue" ? `${item.module}：${item.title} 已过截止` : `${item.module}：${item.title} 截止进入 ${near} 内` }] : [];
  });
}
/** What changed in Chrona, from its own records, the agenda and what apps hand over: names, clipped titles and states. */
async function sense(now: number, seen: Record<string, string>, concerns: Concern[]) {
  const [today, apps, runs, contributed] = await Promise.all([chrona.call("chat.today"), chrona.call("modules.list"), chrona.call("chat.runs"), attention()]) as [Today | null, App[] | null, Run[] | null, Awaited<ReturnType<typeof attention>>];
  // Without Chrona's records (e.g. the build's smoke start) there is nothing to judge.
  if (!today || !Array.isArray(apps) || !Array.isArray(runs)) return null;
  const signals = [...appSignals(apps, seen), ...waitingSignals(today, runs, now), ...agendaSignals(concerns, now), ...attentionSignals(contributed.items, now)];
  const context = {
    dueWithin24h: today.upcoming.filter(item => Date.parse(item.at) >= now && Date.parse(item.at) - now < DAY).map(item => clip(item.label)).slice(0, 10),
    stalledConversations: today.sessions.filter(session => session.status === "active" && !within(now, session.lastActivityAt, 3 * DAY)).map(session => clip(session.title)).slice(0, 10),
    notUseful: today.updates.filter(update => update.feedback === "not_useful" && within(now, update.createdAt, 7 * DAY)).map(update => clip(update.title)).slice(0, 10),
    pausedApps: apps.filter(app => app.status === "paused").map(app => app.name),
    // Absolute times keep the hash stable between sensings; the signals carry how close a deadline is.
    attention: contributed.items.slice(0, 30).map(item => `${item.module} · ${item.kind} · ${item.title}${item.at ? ` · ${item.at.slice(0, 16)}Z` : ""}`),
    attentionUnavailable: contributed.unavailable,
  };
  // The hash covers states and time bands, not when a concern was last written, so the woken Chrona's own notes do not re-trigger it.
  const summary = { signals: signals.map(signal => signal.key), context, concerns: concerns.filter(open).map(concern => [concern.id, concern.status, concern.escalation, band(concern.dueAt, now), revisitDue(concern, now)]) };
  return { summary, context, signals, providerAvailable: today.health.provider.available, seen: Object.fromEntries(apps.flatMap(app => app.activeHash ? [[app.name, app.activeHash]] : [])) };
}

/** Changed and nearest-due matters first. */
function ordered(concerns: Concern[], first: Set<string>) {
  const due = (concern: Concern) => concern.dueAt ? Date.parse(concern.dueAt) : Infinity;
  return concerns.filter(open).sort((a, b) => Number(first.has(b.id)) - Number(first.has(a.id)) || due(a) - due(b));
}
const lastWake = (recent: Stats, now: number) => recent.lastWake ? `${span(recent.lastWake.at, now)}: ${recent.lastWake.outcome?.kind ?? "unreported"}` : null;
/** The System One state (v2-28 §5.1); `minimal` sends no titles at all. */
function intuitionState(sensed: Sensed, fresh: Signal[], concerns: Concern[], recent: Stats, now: number, minimal: boolean) {
  const listed = ordered(concerns, new Set(fresh.flatMap(signal => signal.concern ? [signal.concern] : []))).slice(0, 12);
  return {
    now: new Date(now).toISOString(),
    changes: fresh.slice(0, 12).map(signal => ({ id: signal.key, kind: signal.kind, ...(minimal ? {} : { title: clip(signal.text, 120) }) })),
    agenda: listed.map(concern => {
      const action = concern.commitments.at(-1);
      return { id: concern.id, ...(minimal ? {} : { title: concern.title }), status: concern.status, ...(concern.dueAt ? { due: span(concern.dueAt, now) } : {}), escalation: concern.escalation,
        ...(!minimal && action ? { lastAction: `${span(action.at, now)}: ${clip(action.text)}` } : {}),
        ...(concern.lastAssessment ? { lastAssessed: span(concern.lastAssessment.at, now) } : {}), revisitDue: revisitDue(concern, now) };
    }),
    context: minimal ? Object.fromEntries(Object.entries(sensed.context).map(([name, items]) => [name, items.length])) : sensed.context,
    recent: { lastWake: lastWake(recent, now), wakes7d: recent.wakes7d, useful7d: recent.useful7d, unreported7d: recent.unreported7d },
  };
}
type IntuitionState = ReturnType<typeof intuitionState>;
function questions(state: IntuitionState) {
  const options: Record<string, string> = Object.fromEntries([
    ...state.changes.map(change => [change.id, change.title ?? change.kind]), ...state.agenda.map(concern => [concern.id, concern.title ?? concern.status]), ["nothing", "Nothing needs attention"],
  ]);
  return {
    wake: { type: "noul", instructions: "Something here needs the user's steward to think now: a failure, a deadline closing in, a matter due for review, someone waiting, or a change worth acting on. Routine items, or ones recently assessed with nothing new, do not." },
    focus: { type: "choice", instructions: "What to look at first", criteria: options },
    urgency: { type: "score", instructions: "How urgent", criteria: ["Can wait days", "Today", "Within the hour", "Now"] },
  };
}
function parseAnswer(body: unknown, options: Record<string, string>): Answer | null {
  const answers = (body as { answers?: Record<string, Record<string, unknown> | undefined> } | null)?.answers;
  const wake = answers?.wake?.noul, focus = answers?.focus?.choice, urgency = answers?.urgency?.score;
  if (typeof wake !== "number" || typeof focus !== "string" || !Object.hasOwn(options, focus)) return null;
  // The model's score can leave 0–1 (1.19 seen live); the limits and rules expect a fraction.
  return { wake, focus, urgency: typeof urgency === "number" ? Math.min(1, Math.max(0, urgency)) : 0.5 };
}
/** A System One decision model in the Jev format (`{ model, state, questions }`); any failure is null and the rules decide. */
async function intuition(params: Params, state: IntuitionState): Promise<Answer | null> {
  const key = await chrona.secret({ name: "mind_intuition" }).then(secret => secret.value.key, () => undefined);
  if (!key) return null;
  const asked = questions(state);
  try {
    const response = await fetch(String(params["intuition-url"]), { method: "POST", signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: String(params["intuition-model"] || "jev-latest"), state: JSON.stringify(state), questions: asked }) });
    return response.ok ? parseAnswer(await response.json(), asked.focus.criteria) : null;
  } catch { return null; }
}

function byRules(fresh: Signal[]): Decision {
  if (!fresh.length) return { wake: false, source: "rules", focus: "nothing", urgency: 0 };
  const pressing = fresh.find(signal => signal.kind === "incident" || /^(due|app):.*:(overdue|1h|6h)$/.test(signal.key));
  return { wake: true, source: "rules", focus: (pressing ?? fresh[0]!).concern ?? (pressing ?? fresh[0]!).key, urgency: pressing ? 0.8 : 0.5 };
}
async function decide(params: Params, state: State, asked: () => IntuitionState, fresh: Signal[], now: number): Promise<Decision> {
  const recent = state.calls.filter(at => within(now, at, DAY));
  if (!params["intuition-url"] || recent.length >= number(params, "intuition-daily-calls", 96)) return byRules(fresh);
  state.calls = [...recent, new Date(now).toISOString()];
  const answer = await intuition(params, asked());
  if (answer && answer.wake >= number(params, "wake-threshold", 0.75) && answer.focus !== "nothing") return { wake: true, source: "intuition", focus: answer.focus, urgency: answer.urgency, answer };
  if (answer && answer.wake <= number(params, "sleep-threshold", 0.25)) return { wake: false, source: "intuition", focus: answer.focus, urgency: answer.urgency, answer };
  return { ...byRules(fresh), ...(answer ? { answer } : {}) };
}

function detail(concern: Concern, now: number) {
  return [
    `- ${concern.id} ${concern.title}｜${concern.status}${concern.dueAt ? `｜截止 ${concern.dueAt}（${span(concern.dueAt, now)}）` : ""}｜升级 ${concern.escalation}${concern.revisitAt ? `｜复查 ${span(concern.revisitAt, now)}` : ""}${concern.goal ? `｜目标：${concern.goal}` : ""}`,
    ...(concern.lastAssessment ? [`  上次评估 ${span(concern.lastAssessment.at, now)}（${concern.lastAssessment.by}）：${clip(concern.lastAssessment.conclusion, 200)}`] : []),
    ...concern.commitments.slice(-3).map(item => `  承诺 ${item.at.slice(0, 16)}：${clip(item.text, 160)}`),
    ...concern.userSignals.slice(-3).map(item => `  用户 ${item.at.slice(0, 16)}：${clip(item.text, 160)}`),
  ].join("\n");
}
/** The wake brief (v2-28 §6.1): data for the woken Chrona; the kernel adds how to think about it. Most important first, so clipping drops the tail. */
function brief(entry: Entry, decision: Decision, sensed: Sensed, fresh: Signal[], concerns: Concern[], recent: Stats, now: number) {
  const review = decision.source === "daily", first = new Set([decision.focus, ...fresh.flatMap(signal => signal.concern ? [signal.concern] : [])]);
  const list = ordered(concerns, first);
  const head = review ? "类型：每日回顾——逐条过一遍未关闭的关注。"
    : `来源：${decision.source}${decision.answer ? `（直觉 wake=${decision.answer.wake.toFixed(2)}）` : ""}；主要关注：${decision.focus}；紧急度：${decision.urgency.toFixed(2)}`;
  return [
    `心智唤醒简报 wake-id=${entry.id}`, head, `现在：${new Date(now).toISOString()}`,
    "", "本次变化：", ...(fresh.length ? fresh.map(signal => `- [${signal.key}] ${clip(signal.text, 200)}`) : ["- 无"]),
    "", `近期：上次唤醒 ${lastWake(recent, now) ?? "无"}；7 天唤醒 ${recent.wakes7d} 次，有效 ${recent.useful7d}，无事 ${recent.nothing7d}，未报告 ${recent.unreported7d}`,
    `上下文：${JSON.stringify(sensed.context)}`,
    "", "关注清单：", ...(list.length ? list.map(concern => review || first.has(concern.id) ? detail(concern, now) : `- ${concern.id} ${concern.title}｜${concern.status}${concern.dueAt ? `｜截止 ${span(concern.dueAt, now)}` : ""}`) : ["- （清单为空）"]),
  ].join("\n").slice(0, 4000 - MIND_PROTOCOL.length - 2);
}

/** Self-imposed limits; the kernel's Provider run cap stays the real bound. */
function allowed(params: Params, state: State, urgency: number, now: number) {
  const wakes = state.wakes.filter(at => within(now, at, DAY)), last = wakes.at(-1);
  state.wakes = wakes;
  return wakes.length < number(params, "daily-wakes", 6) && (!last || !within(now, last, urgency >= 0.8 ? HOUR / 4 : HOUR));
}
const due = (trigger: string, params: Params, state: State, now: number) =>
  trigger !== "sense" || !state.lastCheckAt || !within(now, state.lastCheckAt, number(params, "interval-minutes", 15) * 60_000 - 30_000);

async function tick(trigger: string, nowIso: string, params: Params) {
  const now = Date.parse(nowIso);
  const state: State = { lastCheckAt: null, lastHash: null, handled: [], seen: {}, wakes: [], calls: [], lastReview: null, ...await agenda.read<Partial<State>>("state.json", {}) };
  if (params.enabled === false || !due(trigger, params, state, now)) return;
  state.lastCheckAt = nowIso;
  const concerns = await agenda.concerns(), sensed = await sense(now, state.seen, concerns);
  if (sensed) await judge(trigger, nowIso, params, state, sensed, concerns);
  await agenda.write("state.json", state);
}
async function judge(trigger: string, nowIso: string, params: Params, state: State, sensed: Sensed, concerns: Concern[]) {
  const now = Date.parse(nowIso), { summary, signals } = sensed;
  state.seen = sensed.seen;
  const hash = createHash("sha256").update(JSON.stringify(summary)).digest("hex"), fresh = signals.filter(signal => !state.handled.includes(signal.key));
  // Daily: one review of the open matters a day, or of anything that changed.
  const review = trigger === "daily" && !(state.lastReview && within(now, state.lastReview, 20 * HOUR)) && (concerns.some(open) || hash !== state.lastHash);
  if (!sensed.providerAvailable || (!review && hash === state.lastHash)) return;
  // Over the limits even for the most urgent case: decide nothing, look again next time with nothing marked handled.
  if (!allowed(params, state, 1, now)) return;
  const recent = await agenda.stats(now);
  const decision: Decision = review ? { wake: true, source: "daily", focus: "review", urgency: 0.3 }
    : await decide(params, state, () => intuitionState(sensed, fresh, concerns, recent, now, params["intuition-detail"] === "minimal"), fresh, now);
  const entry: Entry = { id: `w-${randomUUID().slice(0, 8)}`, at: nowIso, trigger, source: decision.source, ...(decision.answer ? { answer: decision.answer } : {}),
    wake: decision.wake, focus: decision.focus, urgency: decision.urgency, changes: fresh.map(signal => signal.key) };
  if (decision.wake && !allowed(params, state, decision.urgency, now)) { await agenda.log({ ...entry, blocked: true }); return; }
  if (decision.wake) {
    await chrona.wakeProvider({ key: "wake", prompt: `${MIND_PROTOCOL}\n\n${brief(entry, decision, sensed, fresh, concerns, recent, now)}` });
    state.wakes.push(nowIso);
    if (review) state.lastReview = nowIso;
  }
  await agenda.log(entry);
  state.lastHash = hash;
  state.handled = signals.map(signal => signal.key);
}

on("schedule", async event => { await tick(event.id, event.now, event.params); });
on("tool", async event => ({ result: await agenda.tool(event.id, event.args, event.now, event.caller) }));
