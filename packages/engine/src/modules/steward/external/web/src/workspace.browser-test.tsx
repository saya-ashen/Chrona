// Bundle this entry with Bun, serve with the web shell's style.css, then call workspaceTest.run().
// Uses the production PageView, renderer registry, bound state, existing actions and polling lifecycle.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Workspace, WorkspaceHeader, ScrollArea, Message, Composer, ViewTabs, Panel, ActionOption, CodeDiff } from "./workspace";
import { Markdown } from "./ui";

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function until(check: () => boolean) {
  for (let i = 0; i < 180; i++) { if (check()) return; await frame(); }
  throw new Error("Workspace browser state did not settle");
}
const messages = Array.from({ length: 24 }, (_, i) => ({ id: `message-${i}`, author: i % 4 === 0 ? "用户" : "助手", body: `记录 ${i + 1}：保持阅读位置与输入。\n\n这里是可以继续阅读的执行进展。` }));
const initial = { revision: 1, messages };
function assertions() {
  const checks: string[] = [];
  const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
  const settle = async () => { await frame(); await frame(); await frame(); };
  const poll = async (work: () => void) => { work(); await settle(); };
  return { checks, assert, settle, poll };
}
export function setupWorkspaceTest(element: HTMLElement) {
  const { checks, assert, settle, poll: update } = assertions();
  let snapshot = initial;
  const calls: { target: string; args: Record<string, unknown> }[] = [];
  let setFeed!: (value: typeof initial) => void, setFailure!: (value: string) => void;
  function Page() {
    const [feed, update] = useState(initial), [draft, setDraft] = useState(""), [tab, setTab] = useState("chat"), [sidebar, setSidebar] = useState(true), [answer, choose] = useState(false), [disabled, pause] = useState(false), [error, fail] = useState("");
    setFeed = update; setFailure = fail;
    const send = () => calls.push({ target: "fixture.send", args: { text: draft } });
    return <Workspace title="编码工作台" description="把想法交代清楚，把成果带回来。" breadcrumb="项目 / Chrona" sidebarLabel="工作列表" mainLabel="内容" mobileSidebarOpen={sidebar} sidebar={<><h3>最近工作</h3><label>搜索<input name="search" /></label><ScrollArea label="最近工作"><ActionOption label="继续当前工作" description="等待你的选择" selected compact onClick={() => setSidebar(false)} /><p>没有更多工作</p></ScrollArea></>}>
      <WorkspaceHeader title="检查响应式工作区" status="正在执行" subtitle="保留草稿和阅读位置"><p>{feed.revision}</p></WorkspaceHeader>
      <ViewTabs items={[{ value: "chat", label: "交流" }, { value: "result", label: "成果" }]} value={tab} onChange={setTab} />
      {error ? <p role="alert">{error}</p> : null}
      <ScrollArea label="进展" follow>{feed.messages.map(message => <Message key={message.id} author={message.author}><Markdown content={message.body} /></Message>)}
        <Panel tone="question"><h3>需要你的决定</h3><ActionOption label="使用当前方案" description="保留原有行为并修复布局" selected={answer} onClick={() => { calls.push({ target: "fixture.choose", args: {} }); choose(true); }} /><ActionOption label="暂不可用" disabled onClick={() => calls.push({ target: "fixture.disabled", args: {} })} />{answer ? <p>已选择</p> : null}</Panel>
        <details open><summary>查看变更</summary><CodeDiff filename="src/example.ts" diff={"--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1,2 +1,2 @@\n-const value = 'before';\n+const value = '" + "a".repeat(180) + "';\n export { value };"} /></details><CodeDiff filename="empty.ts" diff="" />
      </ScrollArea>
      <Composer hint="补充到当前工作" footnote="输入不会新建工作" disabled={disabled} onSubmit={send} actions={<>{disabled ? <button onClick={() => pause(false)}>允许发送</button> : <button onClick={() => pause(true)}>暂停发送</button>}<button disabled={disabled} onClick={send}>发送补充</button></>}><label>继续补充<textarea name="draft" rows={2} value={draft} onChange={event => setDraft(event.target.value)} /></label></Composer>
    </Workspace>;
  }
  const root = createRoot(element); root.render(<Page />);
  const poll = (failure?: string) => update(() => {
    if (failure) setFailure(failure); else { setFeed(snapshot); setFailure(""); }
  });
  return {
    checks, calls, stop: () => root.unmount(),
    // eslint-disable-next-line max-statements -- Keep this browser scenario's sequential interactions and assertions together.
    async run() {
      await until(() => !!element.querySelector(".renderer-workspace"));
      const sidebar = element.querySelector("aside")!, main = element.querySelector<HTMLElement>(".workspace-main")!;
      assert(getComputedStyle(sidebar).display !== "none", "initial list is available");
      sidebar.querySelector<HTMLButtonElement>(".renderer-action-option")!.click(); await settle();
      assert(getComputedStyle(main).display !== "none", "existing setState action opens main on mobile");
      assert((getComputedStyle(sidebar).display !== "none") === (window.innerWidth > 700), "mobile selection closes only the mobile sidebar");
      const view = element.querySelector<HTMLElement>('[aria-label="进展"]')!;
      const draft = element.querySelector<HTMLTextAreaElement>("textarea")!;
      assert(view.scrollHeight > view.clientHeight, "progress has its own usable scroll viewport");
      assert(view.scrollHeight - view.clientHeight - view.scrollTop <= 2, "follow starts at latest content");
      assert(draft.getBoundingClientRect().bottom <= window.innerHeight, "composer is visible without page scrolling");
      await poll();
      const tabs = element.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      tabs[1]!.click(); await settle();
      assert(tabs[1]!.getAttribute("aria-selected") === "true", "tabs update bound state without navigation");
      tabs[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); await settle();
      assert(tabs[0]!.getAttribute("aria-selected") === "true" && document.activeElement === tabs[0], "tabs support keyboard selection and focus");
      assert(draft.labels[0]!.textContent.includes("继续补充"), "integrated composer preserves the textarea accessible label");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(draft, "未发送的补充"); draft.dispatchEvent(new Event("input", { bubbles: true }));
      draft.focus(); draft.setSelectionRange(2, 4); await settle();
      view.scrollTop = 180; view.dispatchEvent(new Event("scroll")); const readingTop = view.scrollTop;
      snapshot = { revision: 2, messages: [...messages, { id: "new-1", author: "助手", body: "新的进展，正在等待选择。" }] };
      await poll();
      assert(element.querySelector("textarea") === draft && draft.value === "未发送的补充", "poll preserves input DOM and bound draft");
      assert(document.activeElement === draft && draft.selectionStart === 2 && draft.selectionEnd === 4, "poll preserves input focus and caret");
      assert(Math.abs(view.scrollTop - readingTop) <= 1, "poll preserves earlier reading position");
      assert(element.querySelector(".scroll-new-content"), "new content offers an explicit jump while reading earlier");
      element.querySelector<HTMLButtonElement>(".scroll-new-content")!.click(); await settle();
      assert(view.scrollHeight - view.clientHeight - view.scrollTop <= 2, "jump follows newest content");
      snapshot = { revision: 3, messages: [...snapshot.messages, { id: "new-2", author: "助手", body: "已完成验证，等待下一步。" }] };
      await poll(); assert(view.scrollHeight - view.clientHeight - view.scrollTop <= 2, "poll follows new content only from the bottom");
      const details = element.querySelector("details")!; details.open = false; await poll();
      assert(!details.open, "poll preserves user-collapsed details"); details.open = true;
      const choice = element.querySelector<HTMLButtonElement>('.renderer-action-option:not([disabled]):not([aria-pressed="true"])')!;
      choice.click(); await until(() => calls.some(call => call.target === "fixture.choose")); await settle();
      assert(choice.getAttribute("aria-pressed") === "true", "question option uses existing call result and selected state");
      element.querySelector<HTMLButtonElement>('.renderer-action-option[disabled]')!.click();
      assert(!calls.some(call => call.target === "fixture.disabled"), "disabled option never calls an operation");
      const submit = Array.from(element.querySelectorAll("button")).find(button => button.textContent === "发送补充")!;
      draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
      draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })); await settle();
      assert(!calls.some(call => call.target === "fixture.send"), "newline and IME composition do not send");
      draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); await settle();
      assert(calls.filter(call => call.target === "fixture.send").length === 1, "Enter emits submit once regardless of button styling or order");
      Array.from(element.querySelectorAll("button")).find(button => button.textContent === "暂停发送")!.click(); await settle();
      assert(submit.disabled, "page shares the explicit disabled state with its send button");
      draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); await settle();
      assert(calls.filter(call => call.target === "fixture.send").length === 1 && submit.disabled, "disabled composer neither submits nor clicks another action");
      Array.from(element.querySelectorAll("button")).find(button => button.textContent === "允许发送")!.click(); await settle();
      draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); await settle();
      assert(calls.filter(call => call.target === "fixture.send").length === 2, "reenabling the composer restores keyboard submit");
      submit.click(); await settle();
      const sends = calls.filter(call => call.target === "fixture.send");
      assert(sends.length === 3 && sends.every(call => call.args.text === "未发送的补充"), "keyboard submit and button press resolve the bound draft at action time");
      await poll("受控刷新失败");
      assert(element.textContent.includes("受控刷新失败") && element.textContent.includes("已完成验证"), "failed poll keeps previous content and reports failure");
      await poll(); assert(!element.textContent.includes("受控刷新失败"), "successful poll clears source failure");
      const toggle = element.querySelector<HTMLButtonElement>(".workspace-toolbar button")!;
      view.scrollTop = 180; view.dispatchEvent(new Event("scroll"));
      toggle.click(); await settle(); await poll(); toggle.click(); await settle();
      assert(draft.value === "未发送的补充" && element.querySelector("textarea") === draft, "pane switching preserves draft DOM");
      assert(Math.abs(view.scrollTop - 180) <= 1, "hidden pane polling preserves reading position");
      assert(element.textContent.includes("暂无变更") && element.textContent.includes("没有更多工作"), "empty states remain visible");
      assert(document.documentElement.scrollWidth <= window.innerWidth, "no horizontal page overflow");
      assert(document.documentElement.scrollHeight <= window.innerHeight + 1, "workspace fits viewport without page scrolling");
      const diff = element.querySelector<HTMLElement>(".diff-viewport")!;
      assert(diff.scrollWidth > diff.clientWidth, "long diff lines scroll within diff region");
      if (window.innerWidth > 700) assert(getComputedStyle(sidebar).display !== "none", "desktop sidebar and main coexist");
      return checks;
    },
  };
}
// The fixture host declares the same shell layout class as a registered workspace page.
document.body.classList.add("web-shell-app", "web-shell-workspace");
Object.assign(window, { workspaceTest: setupWorkspaceTest(document.querySelector("main") ?? document.body.appendChild(document.createElement("main"))) });
