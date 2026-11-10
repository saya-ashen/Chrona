// Offline entry-chat fixture; only transport and durable service responses are doubled.
import { mountSystem } from "./pages";
import type { ReplyEvent, SystemHost } from "./system/adapter";
import type { ApplicationDelivery, Execution, Message } from "./system/chat";

type Args = Record<string, unknown>;
type Request = { id: string; runId: string; requestKey: string };
type Admission = { requestKey: string; text: string; reconciliations: { id: string; requestKey: string }[]; createdRuns: string[] };
type Durable = { execution: Execution; messages: Message[]; requests: Request[]; createdRuns: string[]; admission?: Admission };
const session = "web-agent:browser-regression";
const sourceRun = "run-original-failure";
const nextRun = "run-accepted-continuation";
const storageKey = "chat-browser-service";
const progress = "已读取文件，正在核对操作结果。" + "长过程文字".repeat(90);
const reason = "受控执行失败：连接中断，操作结果尚未核对。";
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 180; i++) { if (check()) return; await frame(); }
  throw new Error(`Chat did not settle: ${label}; DOM: ${element.textContent}`);
}
function initial(): Durable {
  return { execution: { runId: sourceRun, status: "failed", active: false, canContinue: true, reason },
    messages: [{ id: "question", direction: "in", text: "请检查文件并核对操作结果" }], requests: [], createdRuns: [] };
}
let state: Durable = (JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as Durable | null) ?? initial();
const save = () => sessionStorage.setItem(storageKey, JSON.stringify(state));
const listeners = new Set<(event: ReplyEvent) => void>();
const calls: { target: string; args: Args }[] = [];
const checks: string[] = [];
const assert = (condition: unknown, label: string) => { if (!condition) throw new Error(`${label}; DOM: ${element.textContent}`); checks.push(label); };
const element = document.querySelector<HTMLElement>("main")!;
const has = (text: string) => element.textContent!.includes(text);
const button = (label: string) => Array.from(element.querySelectorAll("button")).find(item => item.textContent === label);
const statusHas = (text: string) => Array.from(element.querySelectorAll('[role="status"]')).some(item => item.textContent?.includes(text));
let loseResponse = false, rejectResponse: ((error: Error) => void) | undefined;
let failReconcile = false, failExecutionRead = false;

// SystemHost currently exposes web(), not call(). Keep the actual $web adapter in the path.
async function call(target: string, args: Args): Promise<unknown> {
  calls.push({ target, args: structuredClone(args) });
  switch (target) {
    case "$web.sessions": return [{ id: session, title: "失败与继续回归会话", source: "web", createdAt: "2026-11-09T00:00:00Z" }];
    case "$web.messages":
      assert(args.id === session, "messages retains the selected session");
      assert(listeners.size === 1, "real stream subscribes before reading messages");
      return structuredClone(state.messages);
    case "$web.execution":
      assert(args.id === session, "execution retains the selected session");
      if (failExecutionRead) throw new Error("受控执行状态读取失败");
      return structuredClone(state.execution);
    case "$web.transcript": return [];
    case "$web.chat": {
      assert(args.session === session, "ordinary message uses the selected session");
      assert(typeof args.requestKey === "string", "ordinary message uses a request key");
      assert(!state.admission, "ordinary message is sent only once");
      state.admission = { requestKey: args.requestKey as string, text: args.text as string, reconciliations: [], createdRuns: ["run-ordinary-admitted"] };
      state.messages.push({ id: "ordinary-question", direction: "in", text: state.admission.text });
      state.execution = { runId: "pending:ordinary-question", status: "pending", active: true, canContinue: false,
        pendingAdmission: { requestKey: state.admission.requestKey } };
      save();
      return new Promise((_, reject) => { rejectResponse = reject; });
    }
    case "$web.reconcile": {
      const admission = state.admission!;
      assert(args.id === session, "ordinary reconciliation preserves the original session");
      assert(args.requestKey === admission.requestKey, "ordinary reconciliation preserves the saved key");
      assert(Object.keys(args).sort().join(",") === "id,requestKey", "ordinary reconciliation sends only the saved request key");
      admission.reconciliations.push({ id: args.id as string, requestKey: args.requestKey as string }); save();
      if (failReconcile) { failReconcile = false; throw new Error("受控消息核对失败"); }
      state.execution = { runId: admission.createdRuns[0]!, status: "queued", active: true, canContinue: false }; save();
      return { sessionId: session, messageId: "ordinary-question" };
    }
    case "$web.continue": {
      const request = args as unknown as Request;
      assert(request.id === session, "continue retains the original session");
      state.requests.push(structuredClone(request));
      const original = state.requests[0]!;
      assert(request.runId === original.runId && request.requestKey === original.requestKey, "service receives the original continuation identity on every retry");
      if (!state.createdRuns.length) state.createdRuns.push(nextRun);
      if (loseResponse) {
        loseResponse = false;
        state.execution = { runId: nextRun, status: "unknown", active: true, canContinue: false,
          pendingContinuation: { runId: request.runId, requestKey: request.requestKey } };
        save();
        return new Promise((_, reject) => { rejectResponse = reject; });
      }
      state.execution = { runId: nextRun, status: "queued", active: true, canContinue: false };
      save();
      return { runId: nextRun };
    }
    default: throw new Error(`Unexpected fixture call ${target}`);
  }
}
const base = `/sessions/${encodeURIComponent(session)}`;
const host: SystemHost = {
  async web(path, options) {
    if (path === "/sessions") return call("$web.sessions", {});
    if (path === "/chat") {
      assert(options?.method === "POST", "ordinary message uses POST");
      return call("$web.chat", options!.body as Args);
    }
    if (path === `${base}/reconcile`) {
      assert(options?.method === "POST", "ordinary reconciliation uses POST");
      return call("$web.reconcile", { id: session, ...options!.body as Args });
    }
    if (path === `${base}/messages`) return call("$web.messages", { id: session });
    if (path === `${base}/execution`) return call("$web.execution", { id: session });
    if (path === `${base}/transcript`) return call("$web.transcript", { id: session });
    if (path === `${base}/continue`) {
      assert(options?.method === "POST", "continue uses POST");
      return call("$web.continue", { id: session, ...options!.body as Args });
    }
    throw new Error(`Unexpected web path ${path}`);
  },
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  tool: async () => { throw new Error("Chat must not call a real tool"); },
  login: async () => { throw new Error("Chat must not contact login"); },
};
// Drive the real execution poll without waiting for the 1500ms wall clock.
const intervals = new Map<number, () => void>();
let timer = 0;
window.setInterval = ((callback: () => void) => { intervals.set(++timer, callback); return timer; }) as typeof setInterval;
window.clearInterval = id => { if (typeof id === "number") intervals.delete(id); };
let unmount = () => {};
function open() {
  unmount();
  assert(listeners.size === 0 && intervals.size === 0, "unmount removes stream subscriptions and execution timers");
  unmount = mountSystem(element, { name: "chat", path: `/sessions/${encodeURIComponent(session)}` }, host,
    path => { throw new Error(`Unexpected navigation ${path}`); });
}
async function settled() {
  await until(() => !!element.querySelector('textarea[aria-label="消息内容"]') && !!element.querySelector('[aria-label="消息"]') && !element.querySelector('[aria-label="消息"]')!.textContent?.includes("加载中") && !has("正在核对执行状态"), "mounted chat");
  await frame(); await frame();
}
async function poll() { for (const callback of [...intervals.values()]) callback(); await frame(); await frame(); }
async function layout(label: string) {
  await frame();
  assert(document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1,
    `${label}: no document horizontal overflow at ${innerWidth}x${innerHeight}`);
  for (const item of Array.from(element.querySelectorAll<HTMLElement>('[aria-label="消息"], [aria-label="执行状态"], textarea, button'))) {
    const rect = item.getBoundingClientRect();
    assert(rect.width > 0 && rect.left >= -1 && rect.right <= innerWidth + 1, `${label}: visible chat content and controls fit viewport`);
  }
}
function failureVisible() {
  const outcome = element.querySelector('[aria-label="消息"] [role="alert"]');
  assert(outcome?.textContent?.includes("本次执行失败，尚未完成") && outcome.textContent.includes(reason), "durable failure banner includes the reason");
  const bubble = outcome!.parentElement!;
  assert(bubble.textContent?.includes("已产生的过程文字（不代表完成）") && bubble.textContent.includes(progress), "actual early text is retained and labeled as progress, not completion");
  assert(element.querySelectorAll('[aria-label="消息"] [role="alert"]').length === 1, "failure appears once after reconciliation");
}
async function failureAndStates() {
  state = initial(); save(); open(); await settled();
  const early: Message = { id: "reply", direction: "out", text: progress };
  state.messages.push(early); save();
  for (const listener of listeners) listener({ type: "reply", session, message: early.id, text: early.text });
  await until(() => has(progress), "early text renders from subscription");
  assert(!has("本次执行失败，尚未完成"), "early reply is rendered before the failure event");
  const failed: Message = { ...early, text: "", progress, execution: { ...state.execution } };
  state.messages[1] = failed; save();
  for (const listener of listeners) listener({ type: "reply", session, message: failed.id, text: "", progress, execution: failed.execution });
  await until(() => has("本次执行失败，尚未完成"), "failure event updates existing reply");
  failureVisible(); await layout("live failure");
  open(); await settled(); failureVisible(); await layout("remounted failure");
  assert(!state.requests.length, "mount and remount never continue automatically");
  for (const item of [
    { execution: { runId: sourceRun, status: "running", phase: "recovering", active: true, canContinue: false }, label: "Chrona 正在恢复处理，请等待；暂不能继续。" },
    { execution: { runId: sourceRun, status: "unknown", active: true, canContinue: false }, label: "执行是否停止尚未确认，请等待状态更新；暂不能继续。" },
  ]) {
    state.execution = item.execution; save(); await poll();
    await until(() => statusHas(item.label), item.label);
    assert(!button("继续处理") && !button("核对继续请求"), `${item.execution.status}/${item.execution.phase ?? ""} blocks continue`);
    if (item.execution.status === "unknown") assert(button("停止处理")?.disabled, "unknown stop status also disables stop");
    assert(!state.requests.length, "blocked state sends no continuation");
    await layout(item.execution.phase ?? item.execution.status);
  }
  state.execution = { runId: sourceRun, status: "finished", active: false, canContinue: false, replyPending: true };
  state.messages = state.messages.slice(0, 1); save(); open(); await settled();
  assert(statusHas("执行状态已保存，正在读取回复") && !has(progress) && !button("继续处理"), "finished run with unread reply shows retrieval status without promoting cached progress");
  await layout("reply retrieval pending");
  state.execution = { runId: sourceRun, status: "cancelled", active: false, canContinue: true, reason: "用户已停止处理" };
  state.messages[1] = { ...failed, execution: { ...state.execution } }; save();
  open(); await settled();
  assert(statusHas("处理已停止") && !!button("继续处理") && !button("继续处理")!.disabled, "cancelled status exposes an enabled continue action");
  assert(!element.querySelector('[aria-label="消息"] [role="alert"]'), "cancelled outcome uses status rather than failure alert");
  await layout("cancelled");
  button("继续处理")!.click();
  await until(() => statusHas("Chrona 正在排队"), "cancelled run accepts continue");
  assert(state.requests.length === 1 && state.requests[0]!.runId === sourceRun && state.createdRuns.length === 1, "cancelled continue actually submits the source run and becomes queued");
  // Reset the independent cancelled case; leave durable failure for the reload/lost-response case.
  state.execution = { ...failed.execution! }; state.messages[1] = failed;
  state.requests = []; state.createdRuns = []; save();
  return [...checks];
}
async function afterFailureReload() {
  await settled(); failureVisible();
  assert(!state.requests.length && !!button("继续处理"), "reload reconstructs failure and continue from persisted service data");
  await layout("reloaded failure"); return [...checks];
}
async function loseContinue() {
  await settled(); loseResponse = true;
  const continueButton = button("继续处理")!;
  continueButton.click(); continueButton.click();
  await until(() => state.requests.length === 1 && continueButton.disabled, "double-click is in flight");
  assert(state.requests.length === 1 && state.createdRuns.length === 1, "double-click submits one request and accepts one run");
  assert(state.requests[0]!.runId === sourceRun && state.requests[0]!.requestKey === `web-continue:${sourceRun}`, "normal continue uses deterministic source-run request key");
  rejectResponse!(new Error("受控继续响应丢失"));
  await until(() => statusHas("受控继续响应丢失"), "lost response is visible");
  await poll();
  await until(() => !!button("核对继续请求"), "pending continuation requires explicit reconciliation");
  assert(statusHas("继续请求是否受理尚未确认") && !button("继续处理"), "uncertain acceptance shows manual reconciliation instead of a new continue action");
  const before = state.requests.length;
  await poll(); await poll();
  assert(state.requests.length === before, "polling does not automatically replay an uncertain continuation");
  await layout("pending continuation");
  open(); await settled();
  assert(!!button("核对继续请求") && state.requests.length === before, "remount retains pending request without replay");
  assert(state.execution.pendingContinuation?.runId === sourceRun && state.execution.runId === nextRun, "pending identity remains the source run even when current run differs");
  await layout("remounted pending continuation"); return [...checks];
}
async function reconcileAfterReload() {
  await settled();
  assert(!!button("核对继续请求") && !button("继续处理") && state.requests.length === 1, "reload retains manual reconciliation without starting another run");
  await layout("reloaded pending continuation");
  const reconcile = button("核对继续请求")!;
  reconcile.click(); reconcile.click();
  await until(() => statusHas("Chrona 正在排队"), "accepted continuation becomes queued");
  assert(state.requests.length === 2 && state.createdRuns.length === 1, "explicit reconciliation retries transport once and creates no second run");
  assert(state.requests.every(request => request.runId === sourceRun && request.requestKey === `web-continue:${sourceRun}`), "remount and reload preserve original runId and requestKey");
  assert(!button("继续处理") && !button("核对继续请求") && !!button("停止处理"), "queued active run exposes stop and removes continue actions");
  assert(!has("受控继续响应丢失"), "successful reconciliation clears the transport error");
  failureVisible(); await layout("queued continuation");
  state.execution = { runId: nextRun, status: "running", active: true, canContinue: false }; save(); await poll();
  await until(() => statusHas("Chrona 正在处理"), "queued continuation becomes active");
  open(); await settled();
  assert(state.requests.length === 2 && state.createdRuns.length === 1 && !button("继续处理") && !button("核对继续请求"), "active continuation remount never creates a second run");
  await layout("active continuation");
  return [...checks];
}
async function loseOrdinaryMessage() {
  state = initial(); state.execution = { runId: sourceRun, status: "finished", active: false, canContinue: false }; save();
  open(); await settled();
  const textarea = element.querySelector<HTMLTextAreaElement>('textarea[aria-label="消息内容"]')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "请核对这条普通消息");
  textarea.dispatchEvent(new Event("input", { bubbles: true })); await frame();
  const form = textarea.form!;
  form.requestSubmit(); form.requestSubmit();
  await until(() => !!state.admission && !!button("发送")?.disabled, "ordinary message waits for admission response");
  assert(calls.filter(item => item.target === "$web.chat").length === 1, "ordinary message double-submit uses one request");
  rejectResponse!(new Error("受控消息响应丢失"));
  await until(() => statusHas("受控消息响应丢失"), "ordinary lost response is visible");
  await poll();
  await until(() => !!button("核对消息请求"), "ordinary admission exposes manual reconciliation");
  assert(statusHas("消息请求是否受理尚未确认") && !button("停止处理") && !button("继续处理"), "pending ordinary admission has a clear action and no fictitious stop");
  await poll(); await poll();
  assert(!state.admission!.reconciliations.length && calls.filter(item => item.target === "$web.chat").length === 1, "polling never resubmits or reconciles an ordinary message");
  open(); await settled();
  assert(!!button("核对消息请求") && !state.admission!.reconciliations.length, "remount restores ordinary admission without automatic invocation");
  await layout("pending ordinary admission");
  return [...checks];
}
async function reconcileOrdinaryAfterReload() {
  await settled();
  const admission = state.admission!;
  assert(!!button("核对消息请求") && !button("停止处理") && !admission.reconciliations.length, "reload restores ordinary admission and never stops a fictitious run");
  assert(!calls.some(item => ["$web.chat", "$web.reconcile", "$web.continue", "$web.cancel"].includes(item.target)), "reload invokes no message, reconciliation, continuation or cancellation automatically");
  await poll(); await poll();
  assert(!admission.reconciliations.length, "ordinary admission polling after reload remains read only");
  failExecutionRead = true; await poll();
  await until(() => has("执行状态读取失败：受控执行状态读取失败"), "ordinary admission execution read error is visible");
  assert(button("核对消息请求")?.disabled, "ordinary reconciliation is disabled when execution state cannot be read");
  button("核对消息请求")!.click();
  assert(!admission.reconciliations.length, "unreadable execution state blocks ordinary reconciliation");
  failExecutionRead = false; await poll();
  await until(() => !button("核对消息请求")?.disabled, "ordinary admission execution read recovers");
  failReconcile = true;
  const reconcile = button("核对消息请求")!;
  reconcile.click(); reconcile.click();
  await until(() => statusHas("受控消息核对失败"), "ordinary reconciliation failure is visible");
  assert(admission.reconciliations.length === 1 && !!button("核对消息请求") && !button("停止处理"), "failed ordinary reconciliation keeps the manual action and guards double-click");
  await poll(); await poll();
  assert(admission.reconciliations.length === 1, "failed ordinary reconciliation is never automatically retried");
  button("核对消息请求")!.click(); button("核对消息请求")!.click();
  await until(() => statusHas("Chrona 正在排队"), "ordinary reconciliation recovers the admitted run");
  assert(admission.reconciliations.length === 2 && admission.reconciliations.every(item => item.id === session && item.requestKey === admission.requestKey), "ordinary reload and explicit retries retain the exact persisted request key and session");
  assert(admission.createdRuns.length === 1 && !calls.some(item => item.target === "$web.chat"), "ordinary reconciliation recovers one admitted run without sending another message");
  assert(!button("核对消息请求") && !!button("停止处理") && !has("受控消息核对失败"), "successful ordinary reconciliation clears errors and exposes actual run controls");
  assert(element.querySelectorAll('[aria-label="消息"] .in').length === 2 && has(admission.text), "ordinary reconciliation refreshes persisted messages without duplicates");
  await layout("reconciled ordinary admission");
  return [...checks];
}
const deliveryFixture = (): ApplicationDelivery => ({
  receipt: { receiptId: "saved-music-receipt", admissionId: "admission-music", requestKey: "submit-music", submitter: { moduleId: "author-id", hash: "a".repeat(40) }, state: "submitted", approvalId: null,
    members: [{ name: "music", moduleId: "music-id", hash: "b".repeat(40), status: "building", versionId: "version-music", expectedActiveHash: null, materialDigest: "c".repeat(64), selected: true }] },
  receiptCheck: "unknown", targets: [{ name: "music", moduleId: "music-id", hash: "b".repeat(40), activation: "unknown", health: "unknown", pages: [], pagesCheck: "unknown" }], browser: "unknown",
});
async function deliveryAfterTimeout() {
  state = initial();
  state.execution = { runId: sourceRun, status: "timed_out", active: false, canContinue: true, reason: "本次处理超时，尚未完成。", applicationDelivery: [deliveryFixture()] };
  state.messages.push({ id: "delivery-reply", direction: "out", text: "", execution: structuredClone(state.execution) });
  save(); open(); await settled();
  assert(has("saved-music-receipt") && has("回执核对：未知") && has("激活状态：未知") && has("浏览器验证：未知"), "timeout shows saved receipt with unknown proof stages");
  assert(has("本次处理超时，尚未完成") && !!button("继续处理") && !state.requests.length, "delivery never promotes timeout or continues automatically");
  state.messages.push(...Array.from({ length: 24 }, (_, index) => ({ id: `scroll-${index}`, direction: "in", text: `历史消息 ${index}` })));
  save(); await poll(); await until(() => has("历史消息 23"), "long transcript loaded");
  const pane = element.querySelector<HTMLElement>('[aria-label="消息"]')!;
  pane.style.maxHeight = "200px"; pane.style.overflowY = "auto";
  await frame(); pane.scrollTop = 0; pane.dispatchEvent(new Event("scroll")); await frame();
  assert(pane.scrollHeight > pane.clientHeight, "history fixture has a scrollable transcript");
  await poll(); await frame();
  assert(pane.scrollTop === 0, "unchanged delivery polls preserve reading position");
  // Delivery belongs to an older reply while the latest Run stays identical. Drop SSE.
  state.execution = { runId: nextRun, status: "running", active: true, canContinue: false }; save(); await poll();
  const receipt = state.messages[1]!.execution!.applicationDelivery![0]!;
  receipt.receiptCheck = "current";
  receipt.targets[0] = { ...receipt.targets[0]!, activation: "active", health: "observed", pagesCheck: "current", pages: [{ id: "home", title: "打开音乐", href: "/p/music/home" }] };
  save(); await poll();
  await until(() => has("此版本已激活") && !!element.querySelector('a[href="/p/music/home"]'), "delivery update without SSE");
  assert(pane.scrollTop === 0, "late delivery updates preserve reading position");
  assert(has("已观察到运行状态") && has("不代表业务成功") && has("浏览器验证：未知"), "observed activation and health retain unknown browser acceptance");
  assert(state.requests.length === 0 && state.createdRuns.length === 0 && state.messages[1]!.execution!.status === "timed_out", "read-only delivery polling preserves timeout and never starts a Run");
  await layout("late delivery");
  return [...checks];
}
async function deliveryAfterReload() {
  await settled();
  assert(has("saved-music-receipt") && has("本次处理超时，尚未完成") && !!element.querySelector('a[href="/p/music/home"]'), "reload reconstructs exact delivery independently of the current Run");
  const target = state.messages[1]!.execution!.applicationDelivery![0]!.targets[0]!;
  target.activation = "different"; target.health = "unknown"; target.pages = []; target.pagesCheck = "unknown"; save(); await poll();
  await until(() => has("当前激活的是其他版本") && !element.querySelector('a[href="/p/music/home"]'), "mismatched hash removes delivery link");
  assert(has("页面核对：未知") && has("浏览器验证：未知"), "mismatched active hash retains unknown page and browser proof");
  await layout("changed delivery hash"); return [...checks];
}
open();
Object.assign(window, { chatBrowserTest: { failureAndStates, afterFailureReload, loseContinue, reconcileAfterReload, loseOrdinaryMessage, reconcileOrdinaryAfterReload, deliveryAfterTimeout, deliveryAfterReload } });
