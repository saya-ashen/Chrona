// Bundle this entry with Bun, serve with the web shell's style.css, then call workspaceTest.run().
// Uses the production PageView, renderer registry, bound state, existing actions and polling lifecycle.
import { mount, type Page } from "./pages";

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function until(check: () => boolean) {
  for (let i = 0; i < 180; i++) { if (check()) return; await frame(); }
  throw new Error("Workspace browser state did not settle");
}
const messages = Array.from({ length: 24 }, (_, i) => ({ id: `message-${i}`, author: i % 4 === 0 ? "用户" : "助手", body: `记录 ${i + 1}：保持阅读位置与输入。\n\n这里是可以继续阅读的执行进展。` }));
const initial = { revision: 1, messages };
const page: Page = {
  module: "fixture", id: "workspace", title: "通用工作区", data: { feed: { tool: "feed", refresh: .2 } },
  spec: { root: "workspace", state: { draft: "", tab: "chat", sidebarOpen: true, feed: initial, answer: false, composerDisabled: false }, elements: {
    workspace: { type: "Workspace", props: { title: "编码工作台", description: "把想法交代清楚，把成果带回来。", breadcrumb: "项目 / Chrona", sidebarLabel: "工作列表", mainLabel: "内容", mobileSidebarOpen: { $bindState: "/sidebarOpen" } }, slots: { sidebar: ["list-title", "search", "list-scroll"] }, children: ["title", "tabs", "feed-scroll", "composer"] },
    "list-title": { type: "Heading", props: { text: "最近工作" }, children: [] },
    search: { type: "Input", props: { label: "搜索", name: "search", placeholder: "搜索工作" }, children: [] },
    "list-scroll": { type: "ScrollArea", props: { label: "最近工作" }, children: ["select-work", "empty-list"] },
    "select-work": { type: "ActionOption", props: { label: "继续当前工作", description: "等待你的选择", selected: true, compact: true }, on: { press: { action: "setState", params: { statePath: "/sidebarOpen", value: false } } }, children: [] },
    "empty-list": { type: "Text", props: { text: "没有更多工作", variant: "muted" }, children: [] },
    title: { type: "WorkspaceHeader", props: { title: "检查响应式工作区", status: "正在执行", subtitle: "保留草稿和阅读位置" }, children: ["revision"] },
    tabs: { type: "ViewTabs", props: { items: [{ value: "chat", label: "交流" }, { value: "result", label: "成果" }], value: { $bindState: "/tab" } }, children: [] },
    revision: { type: "Text", props: { text: { $state: "/feed/revision" }, variant: "caption" }, children: [] },
    "feed-scroll": { type: "ScrollArea", props: { label: "进展", follow: true }, children: ["feed-items", "question", "diff-details", "empty-diff"] },
    "feed-items": { type: "Stack", props: { gap: "none" }, repeat: { statePath: "/feed/messages", key: "id" }, children: ["message"] },
    message: { type: "Message", props: { author: { $item: "author" } }, children: ["message-body"] },
    "message-body": { type: "Markdown", props: { content: { $item: "body" } }, children: [] },
    question: { type: "Panel", props: { tone: "question" }, children: ["question-title", "option", "disabled", "answer"] },
    "question-title": { type: "Heading", props: { text: "需要你的决定", level: "h3" }, children: [] },
    option: { type: "ActionOption", props: { label: "使用当前方案", description: "保留原有行为并修复布局", selected: { $state: "/answer" } }, on: { press: { action: "call", params: { tool: "choose", args: { answer: "current" }, result: "/answer", reload: false } } }, children: [] },
    disabled: { type: "ActionOption", props: { label: "暂不可用", disabled: true }, on: { press: { action: "call", params: { tool: "disabled" } } }, children: [] },
    answer: { type: "Text", props: { text: "已选择", variant: "muted" }, visible: { $state: "/answer", eq: true }, children: [] },
    "diff-details": { type: "Collapsible", props: { title: "查看变更", defaultOpen: true }, children: ["diff"] },
    diff: { type: "CodeDiff", props: { filename: "src/example.ts", diff: `--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1,2 +1,2 @@\n-const value = 'before';\n+const value = '${"a".repeat(180)}';\n export { value };` }, children: [] },
    "empty-diff": { type: "CodeDiff", props: { filename: "empty.ts", diff: "" }, children: [] },
    composer: { type: "Composer", props: { hint: "补充到当前工作", footnote: "输入不会新建工作", disabled: { $state: "/composerDisabled" } }, on: { submit: { action: "call", params: { tool: "send", args: { text: { $state: "/draft" } }, reload: false } } }, slots: { actions: ["pause-submit", "resume-submit", "submit"] }, children: ["draft"] },
    "pause-submit": { type: "Button", props: { label: "暂停发送" }, visible: { $state: "/composerDisabled", eq: false }, on: { press: { action: "setState", params: { statePath: "/composerDisabled", value: true } } }, children: [] },
    "resume-submit": { type: "Button", props: { label: "允许发送" }, visible: { $state: "/composerDisabled", eq: true }, on: { press: { action: "setState", params: { statePath: "/composerDisabled", value: false } } }, children: [] },
    draft: { type: "Textarea", props: { name: "draft", label: "继续补充", rows: 2, value: { $bindState: "/draft" } }, children: [] },
    submit: { type: "Button", props: { label: "发送补充", variant: "secondary", disabled: { $state: "/composerDisabled" } }, on: { press: { action: "call", params: { tool: "send", args: { text: { $state: "/draft" } }, reload: false } } }, children: [] },
  } },
};

export function setupWorkspaceTest(element: HTMLElement) {
  let snapshot = initial;
  const pending: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
  const calls: { target: string; args: Record<string, unknown> }[] = [];
  const stop = mount(element, page, { call: async (target, args) => {
    if (target === "fixture.feed") return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    calls.push({ target, args }); return target === "fixture.choose" ? true : {};
  }, navigate: () => {}, content: async () => new Blob() });
  const checks: string[] = [];
  const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
  const settle = async () => { await frame(); await frame(); await frame(); };
  const poll = async (failure?: string) => {
    await until(() => pending.length > 0);
    const requests = pending.splice(0);
    requests.forEach(request => failure ? request.reject(new Error(failure)) : request.resolve(snapshot));
    await settle();
  };
  return {
    checks, calls, stop,
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
