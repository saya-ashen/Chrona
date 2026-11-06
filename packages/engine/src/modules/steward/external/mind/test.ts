import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PAGE } from "./page";
// @ts-expect-error Chrona supplies the test kernel at this at run time.
import { startModule } from "chrona/testing";

process.env.CHRONA_DATA = await mkdtemp("/tmp/mind-data-");
const at = (minutes: number) => new Date(Date.parse("2026-10-30T00:00:00Z") + minutes * 60_000).toISOString();
const today = { approvals: [], upcoming: [] as { label: string; at: string }[], updates: [] as { id: string; moduleId: string | null; title: string; body: string; createdAt: string; feedback: string | null }[], sessions: [], health: { provider: { available: true } } };
const health = (id = "i3", revision = 1, activationId = "act-1") => ({ module: "price-watch", moduleId: "mod-1", configuredStatus: "active", activeHash: "a1", activation: { activationId }, incident: { id, revision, status: "unresolved", failures: 5, reason: "timeout" }, contractFailureCount: 0, open: true, truncated: false });
let apps = [{ ...health(), incident: null as ReturnType<typeof health>["incident"] | null, open: false }];
let secondPage: typeof apps = [];
let beforeHealth: (() => Promise<void>) | undefined;
const cursors: unknown[] = [];
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
const pages = new Map<string, typeof PAGE>();
const module = await startModule("activation-harness.ts", { stubs: {
  "web.page-set": (args: typeof PAGE) => { pages.set(args.id, args); return { id: args.id }; },
  "chat.today": () => today, "chat.runs": () => [], "modules.health": async (args: { cursor?: string }) => { await beforeHealth?.(); cursors.push(args.cursor); return { items: args.cursor ? secondPage : apps, nextCursor: !args.cursor && secondPage.length ? "page-2" : null }; }, "secrets.get": () => ({ value: { key: "k1" } }),
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
  for (let i = 0; i < 100 && !existsSync(join(process.env.CHRONA_DATA!, "activation-ready")); i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(existsSync(join(process.env.CHRONA_DATA!, "activation-ready")));
  const activate = () => module.send({ trigger: { kind: "activated", id: "activated", firedAt: at(0) }, now: at(0), params: {} });
  assert.equal((await activate()).error, "Web unavailable");
  assert.equal(pages.size, 0);
  // SDK reports the failed event without killing the handler process; supervisor owns re-delivery.
  assert.deepEqual((await tool("agenda", {}, 0)).concerns, []);
  assert.equal((await activate()).error, undefined);
  const firstPage = pages.get("main");
  assert.equal((await activate()).error, undefined);
  assert.equal(pages.size, 1);
  assert.deepEqual(pages.get("main"), firstPage);
  const registered = module.calls.find((call: { params: { target?: string } }) => call.params.target === "web.page-set");
  const page = registered.params.args;
  assert.equal(page.title, "心智");
  assert.deepEqual(page.spec.elements["due-time"], { type: "Time", props: { value: { $item: "dueAt" } }, children: [] });
  assert.deepEqual(page.spec.elements.due.visible, { $item: "dueAt" });
  // Own-tool references resolve to mind.agenda and mind.decisions, never cross-app tools.
  assert.deepEqual(page.data, { agenda: { tool: "agenda" }, decisions: { tool: "decisions", args: { limit: 1 } } });
  assert.doesNotMatch(JSON.stringify(page.spec), /"on":|"Button"|"Input"/);
  for (const field of ["wakes7d", "useful7d", "nothing7d", "unreported7d", "lastAssessment/conclusion", "build/sessionId"]) assert.ok(JSON.stringify(page.spec).includes(field), field);
  assert.equal(page.spec.elements.source, undefined);
  assert.ok(!page.spec.elements.concerns.children.includes("source"));
  assert.doesNotMatch(JSON.stringify(page.spec), /来源应用|source\/moduleId|修复构建会话/);
  assert.equal(page.spec.elements.build.props.text, "已启动修复构建");
  assert.deepEqual(page.spec.elements.build.visible, { $item: "build/sessionId" });
  // The first look only learns what is there; within the interval nothing is read at all.
  await sense(0);
  assert.equal(wakes().length, 0);
  const calls = module.calls.length;
  await sense(5);
  assert.equal(module.calls.length, calls);
  // A changed active hash is an update: by rules, Chrona is woken with a brief carrying the wake id.
  apps = [{ ...apps[0]!, activeHash: "a2" }];
  await sense(15, { "health-fixes": true });
  assert.equal(wakes().length, 1);
  assert.match(wakes()[0], /price-watch 已更新/);
  assert.match(wakes()[0], /wake-id=w-/);
  assert.match(wakes()[0], /^This run was started by your mind/);
  assert.match(wakes()[0], /Verify first:/);
  assert.match(wakes()[0], /Then m_mind_report/);
  assert.doesNotMatch(wakes()[0], /自主修复已关闭/);
  assert.ok(wakes()[0].length <= 4000);
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
  await sense(435, { "health-fixes": false });
  assert.equal(wakes().length, 2);
  assert.match(wakes()[1], /紧急度：[^\n]+\n自主修复已关闭：不要启动修复构建；说明问题和建议，按需提醒用户，并记录关注。\n现在：/);
  assert.ok(wakes()[1].length <= 4000);
  assert.match(wakes()[1], new RegExp(`due:${concern.id}:24h`));
  assert.match(wakes()[1], /CLS 申请｜waiting-user｜截止 .*（in 23h）/);
  assert.match(wakes()[1], /承诺 .*建了三次提醒/);
  // The woken Chrona reports back; the log counts it.
  assert.deepEqual(await tool("report", { "wake-id": wakeId(wakes()[1]), outcome: "notified", summary: "提醒了" }, 440), { ok: true });
  assert.match((await tool("report", { "wake-id": "w-nope", outcome: "nothing", summary: "x" }, 440)).error, /No wake/);
  const log = await tool("decisions", {}, 440);
  assert.deepEqual([log.stats.wakes7d, log.stats.useful7d, log.stats.unreported7d], [2, 1, 1]);
  assert.deepEqual(log.entries.map((entry: { wake: boolean }) => entry.wake), [true, true]);
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
  apps = [{ ...health(), activeHash: "a2" }];
  await sense(1100, { "intuition-url": "http://127.0.0.1:1/none", "daily-wakes": 5 });
  assert.equal(wakes().length, 5);
  await sense(1115, { "intuition-url": "http://127.0.0.1:1/none" });
  assert.equal(wakes().length, 6);
  assert.match(wakes()[5], /来源：rules；主要关注：health:mod-1:act-1:i3:1；紧急度：0.80/);

  // A long brief still fits provider.wake's 4000-character limit together with the protocol.
  apps = Array.from({ length: 30 }, (_, i) => ({ ...health(`long-${i}`), module: `app-${i}`, incident: { ...health(`long-${i}`).incident, reason: "x".repeat(200) } }));
  await sense(1145, { "daily-wakes": 7 });
  assert.equal(wakes().length, 7);
  assert.equal(wakes()[6].length, 4000);
  assert.match(wakes()[6], /^This run was started by your mind/);
  assert.match(wakes()[6], /m_mind_note/);
  assert.match(wakes()[6], /m_mind_report/);
  // (e) Empty state and agenda still discover an existing unresolved incident.
  const data = process.env.CHRONA_DATA!;
  await writeFile(join(data, "state.json"), "{}");
  await writeFile(join(data, "agenda.json"), "[]");
  apps = [health("first")];
  let count = wakes().length;
  await sense(2000);
  assert.equal(wakes().length, ++count);
  assert.match(wakes().at(-1), /ref: mod-1\/act-1\/first@1/);
  let decisions = await tool("decisions", {}, 2000);
  assert.deepEqual(decisions.entries[0].refs, ["mod-1/act-1/first@1"]);
  await tool("report", { "wake-id": wakeId(wakes().at(-1)), outcome: "acted", summary: "修复中", "session-id": "s-1", "build-session-id": "b-1" }, 2000);
  decisions = await tool("decisions", {}, 2000);
  assert.equal(decisions.entries[0].outcome.buildSessionId, "b-1");
  assert.equal(decisions.entries[0].outcome.sessionId, "s-1");
  // (a) Same revision wakes once; growth wakes again, assessed revisions suppress.
  await sense(2020);
  assert.equal(wakes().length, count);
  apps = [health("first", 2)];
  await sense(2040);
  assert.equal(wakes().length, ++count);
  const source = { "source-module-id": "mod-1", "source-activation-id": "act-1", "source-incident-id": "first" };
  const tracked = (await tool("note", { title: "故障", ...source, "assessed-revision": 3, commitment: "核实未知效果" }, 2040)).concern;
  apps = [health("first", 3)];
  await sense(2060);
  assert.equal(wakes().length, count);
  // (c) Acting/build suppresses new evidence; its reason remains visible in context.
  await tool("note", { id: tracked.id, status: "acting", "build-session-id": "build-1" }, 2060);
  apps = [health("first", 4)];
  await sense(2080);
  assert.equal(wakes().length, count);
  apps[0]!.truncated = true;
  await sense(2100, {}, "daily");
  assert.match(wakes().at(-1), /health:mod-1:act-1:first:4: build in progress/);
  assert.match(wakes().at(-1), /"healthIncomplete":\["price-watch"\]/);
  count = wakes().length;
  // (d) Refusal beats revision growth; a different activation is a new fact.
  await tool("note", { id: tracked.id, status: "watching", "build-session-id": "", declined: "不要修" }, 2100);
  apps = [health("first", 5)];
  await sense(2160);
  assert.equal(wakes().length, count);
  apps = [health("next", 1, "act-2")];
  await sense(2180);
  assert.equal(wakes().length, ++count);
  const replaced = (await tool("agenda", { all: true }, 2180)).concerns[0];
  assert.equal(replaced.status, "done");
  assert.equal(replaced.lastAssessment.conclusion, "已换新版本，旧激活故障不再适用");
  // (g) Real recovery closes deterministically without removing history.
  const next = (await tool("note", { title: "第二次", ...source, "source-activation-id": "act-2", "source-incident-id": "next", commitment: "历史保留" }, 2180)).concern;
  apps[0]!.incident!.status = "recovered";
  apps[0]!.open = false;
  // A note arriving after tick reads the agenda survives the recovery close.
  beforeHealth = async () => {
    beforeHealth = undefined;
    const list = JSON.parse(await readFile(join(data, "agenda.json"), "utf8"));
    await writeFile(join(data, "agenda.json"), JSON.stringify([...list, { ...next, id: "concurrent", title: "新增关注", source: undefined }]));
  };
  await sense(2200);
  const afterClose = (await tool("agenda", { all: true }, 2200)).concerns;
  assert.equal(afterClose.find((item: { id: string }) => item.id === "concurrent").title, "新增关注");
  const recovered = (await tool("agenda", { all: true }, 2200)).concerns.find((item: { id: string }) => item.id === next.id);
  assert.equal(recovered.status, "done");
  assert.equal(recovered.lastAssessment.by, "mind");
  assert.equal(recovered.lastAssessment.conclusion, "对应能力已验证恢复（未重放）");
  assert.equal(recovered.commitments[0].text, "历史保留");
  // (b) A new incident after recovery is not cooled down with the old one.
  apps = [health("worse", 1, "act-2")];
  await sense(2240);
  assert.equal(wakes().length, ++count);
  // (h) Contract mismatches use their count as revision and key.
  apps = [{ ...health(), incident: null, contractFailureCount: 2 }];
  await sense(2280);
  assert.equal(wakes().length, ++count);
  assert.match(wakes().at(-1), /contract:mod-1:act-1:2/);
  apps[0]!.contractFailureCount = 3;
  await sense(2300, { "daily-wakes": 20 });
  assert.equal(wakes().length, ++count);
  // (j) Read all pages, deriving seen and paused apps from those same items.
  secondPage = [{ ...health("paged", 1, "act-page"), module: "page-app", moduleId: "page-mod", configuredStatus: "paused" }];
  await sense(2340, { "daily-wakes": 20 });
  assert.equal(wakes().length, ++count);
  assert.equal(cursors.at(-1), "page-2");
  assert.match(wakes().at(-1), /health:page-mod:act-page:paged:1/);
  assert.match(wakes().at(-1), /"pausedApps":\["page-app"\]/);
  const savedState = JSON.parse(await readFile(join(data, "state.json"), "utf8"));
  assert.equal(savedState.seen["page-app"], "a1");
  secondPage = [];
  // (i) Old agendas update unchanged; updates preserve unknown additive fields.
  const legacy = { id: "legacy", title: "旧关注", status: "watching", escalation: "none", commitments: [], userSignals: [], createdAt: at(0), updatedAt: at(0) };
  await writeFile(join(data, "agenda.json"), JSON.stringify([legacy]));
  assert.equal((await tool("note", { id: "legacy", conclusion: "兼容" }, 2400)).concern.title, "旧关注");
  await tool("note", { id: "legacy", ...source, "assessed-revision": 9, "silent-until": at(2600), declined: "拒绝", "build-session-id": "b-legacy" }, 2400);
  const before = JSON.parse(await readFile(join(data, "agenda.json"), "utf8"))[0];
  before.futureField = { keep: true };
  await writeFile(join(data, "agenda.json"), JSON.stringify([before]));
  const updated = (await tool("note", { id: "legacy", title: "新标题" }, 2420)).concern;
  for (const key of ["source", "assessedRevision", "silentUntil", "declined", "build", "futureField"]) assert.deepEqual(updated[key], before[key]);
  assert.match((await tool("note", { id: "legacy", "source-module-id": "bad id" }, 2420)).error, /id/);
  assert.match((await tool("note", { id: "legacy", ...source, "source-activation-id": "different" }, 2420)).error, /cannot be changed/);
  assert.match((await tool("note", { id: "legacy", "assessed-revision": -1 }, 2420)).error, /nonnegative/);
  await tool("note", { id: "legacy", "silent-until": "", declined: "", "build-session-id": "" }, 2420);
  const cleared = (await tool("agenda", {}, 2420)).concerns[0];
  for (const key of ["silentUntil", "declined", "build"]) assert.equal(cleared[key], undefined);
  // Explicit not-before and closed-topic cooldown are deterministic too.
  apps = [health("first", 10)];
  await tool("note", { id: "legacy", "silent-until": at(2600) }, 2420);
  count = wakes().length;
  await sense(2440, { "daily-wakes": 20 });
  assert.equal(wakes().length, count);
  await tool("note", { id: "legacy", "silent-until": "", status: "dropped" }, 2440);
  await sense(2460, { "daily-wakes": 20 });
  assert.equal(wakes().length, count);
  apps = [health("retry")];
  apps[0]!.incident!.status = "retrying";
  await sense(2480, { "daily-wakes": 20 });
  assert.equal(wakes().length, count);
  apps[0]!.incident!.status = "verifying";
  await sense(2500, { "daily-wakes": 20 });
  assert.equal(wakes().length, count + 1);
  assert.match(wakes().at(-1), /连接已恢复、功能待验证/);
  // No fresh signal means no intuition call, even as polling labels and attention context change.
  await writeFile(join(data, "state.json"), "{}");
  await writeFile(join(data, "agenda.json"), "[]");
  apps = [{ ...health(), module: "mind", moduleId: "mind-id", incident: null, open: false }];
  contributions = [];
  count = wakes().length;
  const callsBefore = seen.length;
  await sense(3000, { "intuition-url": url });
  const initialHash = JSON.parse(await readFile(join(data, "state.json"), "utf8")).lastHash;
  today.upcoming = [{ label: "gmail poll 3015", at: at(3020) }];
  await sense(3015, { "intuition-url": url });
  assert.equal(seen.length, callsBefore);
  assert.equal(wakes().length, count);
  assert.equal(JSON.parse(await readFile(join(data, "state.json"), "utf8")).lastHash, initialHash);
  const silent = (await tool("note", { title: "[career-ops] ETH AI Center赵文明老师推荐", goal: "ETH AI Center reference letters", status: "waiting-user", escalation: "final", "due-at": at(2900), "revisit-at": at(2900), "silent-until": at(4000), conclusion: "等待推荐信回执" }, 3020)).concern;
  await sense(3030, { "intuition-url": url });
  assert.equal(wakes().length, count);
  assert.equal(seen.length, callsBefore);
  // An independent signal lets us inspect the intuition agenda: silent overdue concerns are absent.
  intuition = { wake: { type: "noul", noul: 0.1 }, focus: { type: "choice", choice: "nothing", confidence: 0.9 }, urgency: { type: "score", score: 0, confidence: 0.9 } };
  apps[0]!.activeHash = "mind-a2";
  await sense(3045, { "intuition-url": url });
  assert.deepEqual(JSON.parse(seen.at(-1)!.body.state).agenda, []);
  assert.equal(wakes().length, count);
  const notice = { id: "mail-eth", moduleId: "gmail-id", title: "[ETH AI Center] Receipt confirmation of your reference letters", body: "At least two of three referees have submitted.", createdAt: at(3050), feedback: null };
  today.updates = [notice];
  await sense(3060, { "intuition-url": url });
  assert.equal(wakes().length, ++count);
  assert.equal(seen.length, callsBefore + 1, "notice evidence bypasses intuition sleep");
  assert.match(wakes().at(-1), /来源：rules/);
  assert.ok(wakes().at(-1).includes(`[notice:mail-eth] (${silent.id})`));
  assert.ok(wakes().at(-1).includes(notice.body));
  assert.match(wakes().at(-1), /等待推荐信回执/);
  await sense(3120, { "intuition-url": url });
  assert.equal(wakes().length, count);
  assert.equal(seen.length, callsBefore + 1);
  // Unrelated and self/kernel notifications never become evidence, even with identical topic text.
  today.updates = [notice, { ...notice, id: "promo", title: "Pinterest weekly inspiration", body: "Fresh design ideas for you" }, { ...notice, id: "self", moduleId: "mind-id" }, { ...notice, id: "kernel", moduleId: null }];
  await sense(3180, { "intuition-url": url });
  assert.equal(wakes().length, count);
  assert.equal(seen.length, callsBefore + 1);
  // Persist pending evidence while the provider is unavailable, even after it drops out of today's window.
  today.health.provider.available = false;
  today.updates = [{ ...notice, id: "mail-eth-next" }];
  await sense(3240);
  today.health.provider.available = true;
  today.updates = [];
  await sense(3300);
  assert.equal(wakes().length, ++count);
  assert.match(wakes().at(-1), /notice:mail-eth-next/);
  await sense(3360);
  assert.equal(wakes().length, count);
  // Silence expiring restores deadline/revisit signals.
  await sense(4000);
  assert.equal(wakes().length, ++count);
  assert.ok(wakes().at(-1).includes(`due:${silent.id}:overdue`));
  // (f) The original daily-wakes assertions above still exercise the quota.
  for (const prompt of wakes()) {
    assert.ok(prompt.length <= 4000);
    assert.match(prompt, /^This run was started by your mind/);
  }
} finally { await module.stop(); await server.stop(true); }
