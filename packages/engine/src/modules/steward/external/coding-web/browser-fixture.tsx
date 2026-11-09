// Offline fixture: uses production PageView and this ordinary client's adapter.
import { mount, type Page } from "../web/src/pages";
declare const REGISTERED_PAGE: Page;
import { createClient, type Call } from "./client";
const commands: Record<string, unknown>[] = [];
const uiCalls: { target: string; args: Record<string, unknown> }[] = [];
const projects = [{ projectRef: "p1", label: "示例项目", path: "/tmp/project" }, { projectRef: "p2", label: "另一项目", path: "/tmp/other" }];
const session = { id: "s1", title: "修复测试", projectRef: "p1", currentWorkId: null, workIds: [], turns: [] };
let first = true, pending = false, loseNext = false;
const receipts = new Map<string, Record<string, unknown>>();
const coding: Call = async <T,>(_target: string, args: Record<string, unknown>) => {
  const c = JSON.parse(String(args.input)); commands.push(c);
  let output: unknown;
  switch (c.op) {
    case "projects.list": output = { projects, defaultProjectRef: "p1" }; break;
    case "conversations.list": output = { sessions: c.projectRef === "p2" ? [{ ...session, id: "s2", title: "另一对话", projectRef: "p2" }] : [session] }; break;
    case "conversations.get": output = { session: { ...session, id: c.sessionId, projectRef: c.sessionId === "s2" ? "p2" : "p1" }, view: first ? null : { workId: "w1", runId: "r1", attemptId: "a1", status: "running", stopConfirmed: false, cancelRequested: false }, history: { messages: [{ id: "m1", author: "编码助手", content: "可以开始对话。", timestamp: "", status: "" }], hasEarlier: false, before: null, limited: false } }; break;
    case "snapshot": output = { workId: "w1", runId: "r1", attemptId: "a1", status: "running", stopConfirmed: false, cancelRequested: false, questions: [{ requestId: "q1", title: "选择验证方式", method: "select", options: ["运行本地测试", "跳过检查"], status: "pending" }], finalMessage: null, missing: false }; break;
    case "events": output = { events: [], gap: false }; break;
    case "results": output = { results: [{ resultId: "result1", artifactRef: "saved-result", accepted: false, checks: [{ command: "bun test", outcome: "passed", exitCode: 0 }] }] }; break;
    case "read-result": output = { mime: "application/json", base64: btoa(JSON.stringify({ finalMessage: { text: "Saved final reply", truncated: false }, changes: { status: "complete", patch: "diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n", files: [] } })) }; break;
    case "receipt": output = { receipt: { ...receipts.get(c.requestKey), status: pending ? "pending" : "accepted" } }; break;
    default: {
      first = false;
      const receipt = { requestKey: c.requestKey, op: c.op, status: pending ? "pending" : "accepted", value: c.op === "conversations.create" ? session : projects[0] };
      receipts.set(c.requestKey, receipt); output = { receipt };
      if (loseNext) { loseNext = false; throw new Error("模拟回复丢失"); }
      break;
    }
  }
  return output as T;
};
const client = createClient(coding);
const page: Page = { ...REGISTERED_PAGE, data: { ...REGISTERED_PAGE.data, catalog: { ...REGISTERED_PAGE.data.catalog!, refresh: .2 }, detail: { ...REGISTERED_PAGE.data.detail!, refresh: .2 } } };
document.body.classList.add("web-shell-app", "web-shell-workspace");
const stop = mount(document.querySelector("main")!, page, { call: async (target, args) => {
  uiCalls.push({ target, args });
  switch (target) {
    case "coding-web.ui-request": return { nextRequestKey: crypto.randomUUID() };
    case "coding-web.ui-catalog": return client.catalog(args);
    case "coding-web.ui-work": return client.work(args);
    case "coding-web.ui-result": return client.result(args);
    case "coding-web.ui-command": return client.command(args);
    case "coding-web.ui-receipt": return client.receipt(args);
    default: throw new Error(`Unexpected UI target ${target}`);
  }
}, navigate: () => {}, content: async () => new Blob() });
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function until(check: () => boolean) { for (let i = 0; i < 240; i++) { if (check()) return; await frame(); } throw new Error("Browser did not settle: " + document.body.innerText); }
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b => (b.querySelector(".option-label, .workspace-mobile-label")?.textContent ?? b.textContent)?.trim() === label)!;
async function press(label: string) { await until(() => !!button(label)); button(label).click(); await frame(); await frame(); }
const input = (selector: string, text: string) => { const el = document.querySelector<HTMLTextAreaElement>(selector)!; const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, text); el.dispatchEvent(new Event("input", { bubbles: true })); };
async function choose(project: string, conversation: string, draft = "") {
  await until(() => !!button(project));
  if (innerWidth <= 700) await press("返回项目与对话");
  await press(project);
  if (innerWidth <= 700) await press("返回项目与对话");
  await press(conversation);
  await until(() => !!document.querySelector('textarea[name="message"]'));
  input('textarea[name="message"]', draft); await frame();
}
Object.assign(window, { codingWebTest: { commands, uiCalls, stop, choose, selection() { return { project: uiCalls.filter(c => c.target === "coding-web.ui-catalog").at(-1)?.args.project, session: uiCalls.filter(c => c.target === "coding-web.ui-work").at(-1)?.args["session-id"], draft: document.querySelector<HTMLTextAreaElement>('textarea[name="message"]')?.value }; }, async run() {
  const checks: string[] = [];
  const assert = (value: unknown, label: string) => { if (!value) throw new Error(label + ": " + JSON.stringify(uiCalls)); checks.push(label); };
  await choose("示例项目", "修复测试");
  assert(!commands.some(c => c.op === "select" || c.requestKey), "selection stays in the browser");
  input('textarea[name="message"]', "第一轮需求"); await frame();
  await press("发送");
  await until(() => commands.some(c => c.op === "round.send"));
  assert(commands.find(c => c.op === "round.send")!.workId === null, "first send forwards null work ID");
  await until(() => document.querySelector<HTMLTextAreaElement>('textarea[name="message"]')?.value === "");
  await until(() => !!button("运行本地测试"));
  await press("运行本地测试");
  await until(() => commands.some(c => c.op === "round.answer"));
  const answer = commands.find(c => c.op === "round.answer")!;
  assert(answer.questionId === "q1" && answer.workId === "w1" && answer.runId === "r1" && answer.attemptId === "a1", "question choices retain exact execution identity");
  input('textarea[name="message"]', "继续完善"); await frame();
  const reads = commands.filter(c => c.op === "conversations.get").length;
  await until(() => commands.filter(c => c.op === "conversations.get").length > reads);
  assert(document.querySelector<HTMLTextAreaElement>('textarea[name="message"]')?.value === "继续完善", "poll preserves private draft");
  document.querySelector<HTMLTextAreaElement>('textarea[name="message"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await until(() => commands.filter(c => c.op === "round.send").length === 2);
  assert(commands.filter(c => c.op === "round.send")[1]!.workId === "w1", "Enter continues the current round");
  await press("成果");
  await until(() => document.body.innerText.includes("saved-result"));
  assert(document.body.innerText.includes("bun test：passed"), "results show saved reference and checks");
  await press("查看成果");
  await until(() => document.body.innerText.includes("Saved final reply"));
  assert(commands.some(c => c.op === "read-result" && c.sessionId === "s1" && c.workId === "w1" && c.resultId === "result1"), "saved result read retains conversation and round scope");
  assert(document.documentElement.scrollWidth <= innerWidth, "no horizontal page overflow");
  assert(document.documentElement.scrollHeight <= innerHeight + 1, "workspace fits viewport");
  await press("交流");
  pending = true;
  input('textarea[name="message"]', "待核对消息"); await frame(); await press("发送");
  await until(() => !!button("查询操作回执"));
  assert(document.querySelector<HTMLTextAreaElement>('textarea[name="message"]')?.value === "待核对消息", "pending receipt preserves draft");
  assert(button("发送").disabled, "pending receipt blocks a new mutation");
  const pendingCommand = commands.filter(c => c.op === "round.send").at(-1)!;
  pending = false; await press("查询操作回执");
  await until(() => !button("发送").disabled);
  assert(commands.some(c => c.op === "receipt" && c.requestKey === pendingCommand.requestKey), "receipt lookup keeps original request key");
  loseNext = true;
  input('textarea[name="message"]', "回复丢失的消息"); await frame(); await press("发送");
  await until(() => !!button("查询操作回执"));
  assert(document.querySelector<HTMLTextAreaElement>('textarea[name="message"]')?.value === "回复丢失的消息", "lost reply preserves private draft");
  const lostCommand = commands.filter(c => c.op === "round.send").at(-1)!;
  await press("查询操作回执"); await until(() => !button("发送").disabled);
  assert(commands.some(c => c.op === "receipt" && c.requestKey === lostCommand.requestKey), "lost reply recovers by the submitted request key");
  assert(commands.filter(c => c.op === "round.send" && c.text === "回复丢失的消息").length === 1, "receipt recovery never replays a send");
  const sendsBefore = commands.filter(c => c.op === "round.send").length;
  input('textarea[name="message"]', ""); await frame(); await press("发送");
  await until(() => document.body.innerText.includes("长度无效"));
  assert(commands.filter(c => c.op === "round.send").length === sendsBefore && !button("发送").disabled, "invalid input can be corrected without transport recovery");
  assert(uiCalls.every(c => c.target.startsWith("coding-web.ui-")), "page calls only its own tools");
  const before = commands.length; stop(); await frame();
  assert(commands.length === before, "unmount never stops Coding");
  return checks;
} } });
