import { strict as assert } from "node:assert";
import { mkdtemp } from "node:fs/promises";
// @ts-expect-error Chrona supplies the test kernel at this at run time.
import { startModule } from "chrona/testing";

process.env.CHRONA_DATA = await mkdtemp("/tmp/mind-data-");
const at = (minutes: number) => new Date(Date.parse("2026-10-30T00:00:00Z") + minutes * 60_000).toISOString();
const today = { approvals: [], upcoming: [], updates: [], sessions: [], health: { provider: { available: true } } };
let apps = [{ name: "price-watch", status: "active", activeHash: "a1", incident: null as null | object }];
let contributions: { module: string; hash: string; value: unknown }[] = [];
let calendar: unknown = { items: [] };
let intuition = { wake: { type: "noul", noul: 0.1 }, focus: { type: "choice", choice: "nothing", confidence: 0.9 }, urgency: { type: "score", score: 0, confidence: 0.9 } };
type Seen = { authorization: string | null; body: { model: string; state: string; questions: Record<string, { type: string; criteria?: Record<string, string> }> } };
const seen: Seen[] = [];
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
  seen.push({ authorization: request.headers.get("authorization"), body: await request.json() });
  return Response.json({ model: "jev-test", answers: intuition });
} });
const url = `http://127.0.0.1:${server.port}/v1/systemone`;
const module = await startModule("index.ts", { stubs: {
  "chat.today": () => today, "chat.runs": () => [], "modules.list": () => apps, "secrets.get": () => ({ value: { key: "k1" } }),
  "modules.contributions": () => contributions, "calendar.attention": () => calendar,
} });
const wakes = () => module.calls.filter((call: { params: { target?: string } }) => call.params.target === "provider.wake").map((call: { params: { args: { prompt: string } } }) => call.params.args.prompt);
const sense = async (minutes: number, params: Record<string, string | number | boolean> = {}, id = "sense") => {
  const reply = await module.send({ trigger: { kind: "schedule", id, firedAt: at(minutes) }, now: at(minutes), params: { enabled: true, "interval-minutes": 15, "daily-wakes": 6, "intuition-url": "", "intuition-model": "jev-latest", "intuition-daily-calls": 96, "wake-threshold": 0.75, "sleep-threshold": 0.25, "intuition-detail": "titles", ...params } });
  assert.equal(reply.error, undefined);
};
const tool = async (id: string, args: Record<string, unknown>, minutes: number, caller: object = { kind: "provider", runId: "r1" }) => {
  const reply = await module.send({ trigger: { kind: "tool", id, firedAt: at(minutes), args, caller }, now: at(minutes), params: {} });
  assert.equal(reply.error, undefined);
  return reply.result.result;
};
const wakeId = (prompt: string) => /wake-id=(w-[0-9a-f]+)/.exec(prompt)![1]!;
try {
  // The first look only learns what is there; within the interval nothing is read at all.
  await sense(0);
  assert.equal(wakes().length, 0);
  const calls = module.calls.length;
  await sense(5);
  assert.equal(module.calls.length, calls);
  // A changed active hash is an update: by rules, Chrona is woken with a brief carrying the wake id.
  apps = [{ ...apps[0]!, activeHash: "a2" }];
  await sense(15);
  assert.equal(wakes().length, 1);
  assert.match(wakes()[0], /price-watch 已更新/);
  assert.match(wakes()[0], /wake-id=w-/);
  assert.match(wakes()[0], /^This run was started by your mind/);
  assert.match(wakes()[0], /Verify first:/);
  assert.match(wakes()[0], /Then m_mind_report/);
  // Nothing changed since: no wake, and the user's toggle stops it entirely.
  await sense(30);
  await sense(45, { enabled: false });
  assert.equal(wakes().length, 1);

  // The agenda: a matter handed over in a conversation, validated.
  assert.match((await tool("note", {}, 50)).error, /title/);
  assert.match((await tool("note", { id: "c-nope" }, 50)).error, /No concern/);
  const { concern } = await tool("note", { title: "CLS 申请", goal: "2027 PhD", status: "waiting-user", "due-at": at(1815), commitment: "建了三次提醒" }, 50);
  assert.match(concern.id, /^c-/);
  assert.equal(concern.escalation, "none");
  // A new matter far from its deadline is a change but no reason to wake.
  await sense(60);
  assert.equal(wakes().length, 1);
  // Time passing is itself a change: entering the last 24 hours wakes Chrona with the matter in full.
  await sense(435);
  assert.equal(wakes().length, 2);
  assert.match(wakes()[1], new RegExp(`due:${concern.id}:24h`));
  assert.match(wakes()[1], /CLS 申请｜waiting-user｜截止 .*（in 23h）/);
  assert.match(wakes()[1], /承诺 .*建了三次提醒/);
  // The woken Chrona reports back; the log counts it.
  assert.deepEqual(await tool("report", { "wake-id": wakeId(wakes()[1]), outcome: "notified", summary: "提醒了" }, 440), { ok: true });
  assert.match((await tool("report", { "wake-id": "w-nope", outcome: "nothing", summary: "x" }, 440)).error, /No wake/);
  const log = await tool("decisions", {}, 440);
  assert.deepEqual([log.stats.wakes7d, log.stats.useful7d, log.stats.unreported7d], [2, 1, 1]);
  assert.deepEqual(log.entries.map((entry: { wake: boolean }) => entry.wake), [true, false, false, true, false]);
  assert.equal(log.entries.find((entry: { id: string }) => entry.id === wakeId(wakes()[1])).outcome.kind, "notified");
  // Escalation only rises.
  assert.equal((await tool("note", { id: concern.id, escalation: "day-before", conclusion: "用户已知" }, 445)).concern.escalation, "day-before");
  assert.match((await tool("note", { id: concern.id, escalation: "early" }, 445)).error, /only rises/);

  // The intuition model sees time, the agenda and the last outcomes, and may pick a matter; a confident "no" keeps Chrona asleep.
  await tool("note", { id: concern.id, "revisit-at": at(500) }, 450);
  await sense(510, { "intuition-url": url });
  assert.equal(wakes().length, 2);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.authorization, "Bearer k1");
  const state = JSON.parse(seen[0]!.body.state);
  assert.equal(state.now, at(510));
  assert.deepEqual(state.changes.map((change: { id: string }) => change.id), [`revisit:${concern.id}:${at(500)}`]);
  assert.deepEqual([state.agenda[0].id, state.agenda[0].title, state.agenda[0].due, state.agenda[0].revisitDue], [concern.id, "CLS 申请", "in 22h", true]);
  assert.equal(state.recent.useful7d, 1);
  assert.deepEqual(Object.keys(seen[0]!.body.questions.focus!.criteria!), [`revisit:${concern.id}:${at(500)}`, concern.id, "nothing"]);
  // `minimal` sends no titles at all.
  await tool("note", { id: concern.id, "revisit-at": at(530) }, 520);
  await sense(540, { "intuition-url": url, "intuition-detail": "minimal" });
  assert.equal(seen.length, 2);
  assert.doesNotMatch(seen[1]!.body.state, /CLS|title/);
  // A confident "yes" on a matter wakes it with that focus.
  intuition = { wake: { type: "noul", noul: 0.95 }, focus: { type: "choice", choice: concern.id, confidence: 0.9 }, urgency: { type: "score", score: 1.19, confidence: 0.8 } };
  await tool("note", { id: concern.id, "revisit-at": at(560) }, 550);
  await sense(570, { "intuition-url": url });
  assert.equal(wakes().length, 3);
  assert.match(wakes()[2], new RegExp(`来源：intuition（直觉 wake=0.95）；主要关注：${concern.id}；紧急度：1.00`));

  // The daily review looks over the open matters even without a change, once a day and within the wake limits.
  await sense(600, {}, "daily");
  assert.equal(wakes().length, 3);
  await sense(700, {}, "daily");
  assert.equal(wakes().length, 4);
  assert.match(wakes()[3], /每日回顾/);
  await sense(1000, {}, "daily");
  assert.equal(wakes().length, 4);

  // Dropped by the user: off the open agenda, still listed with all.
  await tool("note", { id: concern.id, status: "dropped", "user-signal": "放弃了" }, 1010, { kind: "owner", via: null });
  assert.deepEqual((await tool("agenda", {}, 1010)).concerns, []);
  const [closed] = (await tool("agenda", { all: true }, 1010)).concerns;
  assert.deepEqual([closed.status, closed.userSignals.at(-1).text], ["dropped", "放弃了"]);

  // Apps hand over what deserves attention (v2-28 §4.1): a deadline within 6 hours wakes by rules, malformed items are
  // dropped, and an app whose tool is not visible to modules is listed as unavailable without blocking sensing.
  contributions = [{ module: "calendar", hash: "c1", value: { attention: "attention" } }, { module: "planning", hash: "p1", value: { attention: "attention" } }];
  calendar = { items: [{ id: "m1", kind: "deadline", title: "组会", at: at(1340) }, { id: "bad id", kind: "pending", title: "x" }, { id: "p2", kind: "deadline", title: "无时间" }] };
  await sense(1040);
  assert.equal(wakes().length, 5);
  assert.match(wakes()[4], /来源：rules；主要关注：app:calendar:m1:6h；紧急度：0.80/);
  assert.match(wakes()[4], /calendar：组会 截止进入 6h 内/);
  assert.match(wakes()[4], /"attentionUnavailable":\["planning"\]/);
  assert.doesNotMatch(wakes()[4], /无时间|bad id/);
  assert.ok(module.calls.some((call: { params: { target?: string; args?: object } }) => call.params.target === "calendar.attention"));

  // An unreachable model falls back to the rules, which see the failure, within the wake limits.
  apps = [{ ...apps[0]!, incident: { id: "i3", status: "unresolved", failures: 5, reason: "timeout" } }];
  await sense(1100, { "intuition-url": "http://127.0.0.1:1/none", "daily-wakes": 5 });
  assert.equal(wakes().length, 5);
  await sense(1115, { "intuition-url": "http://127.0.0.1:1/none" });
  assert.equal(wakes().length, 6);
  assert.match(wakes()[5], /来源：rules；主要关注：incident:i3；紧急度：0.80/);

  // A long brief still fits provider.wake's 4000-character limit together with the protocol.
  apps = Array.from({ length: 30 }, (_, i) => ({ name: `app-${i}`, status: "active", activeHash: "a1", incident: { id: `long-${i}`, status: "unresolved", failures: 5, reason: "x".repeat(200) } }));
  await sense(1145, { "daily-wakes": 7 });
  assert.equal(wakes().length, 7);
  assert.equal(wakes()[6].length, 4000);
  for (const prompt of wakes()) {
    assert.ok(prompt.length <= 4000);
    assert.match(prompt, /^This run was started by your mind/);
  }
} finally { await module.stop(); await server.stop(true); }
