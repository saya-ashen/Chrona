// Bundle with Bun for a real browser, then call executableComponentsTest.run().
// No audio fetch/playback, model, database, or application server is used.
import { mount, registeredDeps, type Page } from "./pages";
import type { ExecutableContext } from "./executable-components";

type Probe = { mounts: number; destroys: number; updates: number; context?: ExecutableContext; releaseImport?: () => void };
const probe: Probe = { mounts: 0, destroys: 0, updates: 0 };
Object.assign(window, { executableProbe: probe });
const javascript = `export default function mount(element, context) {
  const probe = window.executableProbe;
  probe.mounts++; probe.context = context;
  const label = document.createElement('p'); label.setAttribute('data-label', ''); label.textContent = context.props.label;
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'audio/*'; input.setAttribute('aria-label', '选择测试文件');
  const audio = document.createElement('audio'); audio.controls = true; audio.setAttribute('aria-label', '本地音频控件');
  const selected = document.createElement('output'); selected.setAttribute('aria-label', '已选文件');
  input.onchange = () => { selected.textContent = input.files[0]?.name || ''; context.emit('selected'); };
  const action = document.createElement('button'); action.textContent = '组件读取'; action.onclick = () => context.call('inspect', {filename: input.files[0]?.name}).then(result => selected.textContent = result.text);
  element.append(label, input, audio, selected, action);
  return { update(next) { probe.updates++; if (next.props.label === 'fail-update') throw new Error('受控更新失败'); label.textContent = next.props.label; }, destroy() { probe.destroys++; input.onchange = null; action.onclick = null; } };
}`;
const fixture: Page = {
  module: "fixture", moduleId: "module-fixture", id: "executable", title: "可信组件测试", revision: "page-pin", hash: "approved-hash", data: {},
  extensions: { "fixture:AudioPlayer": { revision: "component-pin", props: { type: "object" }, events: ["selected"], slots: ["default", "footer"], tools: ["inspect"] } },
  spec: { root: "root", state: { label: "初始标题", selected: false }, elements: {
    root: { type: "Stack", props: {}, children: ["audio", "selected", "update", "break"] },
    audio: { type: "fixture:AudioPlayer", props: { label: { $state: "/label" } }, on: { selected: { action: "setState", params: { statePath: "/selected", value: true } } }, children: ["child"], slots: { footer: ["footer"] } },
    footer: { type: "Text", props: { text: "标准具名插槽" } },
    child: { type: "Text", props: { text: "标准子组件" } },
    selected: { type: "Text", props: { text: "选中文件事件已收到" }, visible: { $state: "/selected", eq: true } },
    update: { type: "Button", props: { label: "更新属性" }, on: { press: { action: "setState", params: { statePath: "/label", value: "更新标题" } } } },
    break: { type: "Button", props: { label: "触发更新错误" }, on: { press: { action: "setState", params: { statePath: "/label", value: "fail-update" } } } },
  } },
};
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function until(check: () => boolean) {
  for (let i = 0; i < 180; i++) { if (check()) return; await frame(); }
  throw new Error("Executable component browser state did not settle");
}
export function setupExecutableComponentsTest() {
  const element = document.createElement("main"); document.body.append(element);
  const checks: string[] = [], requests: { path: string; options?: { raw?: boolean; body?: unknown } }[] = [];
  let source = javascript, rejectLoad = false, hold: Promise<Blob> | undefined, callHold: Promise<unknown> | undefined;
  const resource = () => new Blob([JSON.stringify({ name: "AudioPlayer", module: fixture.module, moduleId: fixture.moduleId, hash: "approved-hash", revision: "component-pin", javascript: source, css: '[data-label] { overflow-wrap: anywhere; }' })], { type: "application/json" });
  const deps = registeredDeps(fixture, async (path, options) => {
    requests.push({ path, options });
    if (path.startsWith("/components/")) { if (rejectLoad) throw new Error("受控组件读取失败"); return hold ?? resource(); }
    if (path === "/call") return callHold ?? { text: "组件操作已完成" };
    throw new Error(`Unexpected request: ${path}`);
  }, () => {});
  let stop = () => {};
  const open = () => { stop(); stop = mount(element, fixture, deps); };
  const has = (text: string) => element.textContent.includes(text);
  const press = (label: string) => Array.from(element.querySelectorAll("button")).find(button => button.textContent === label)!.click();
  const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
  const settle = async () => { await frame(); await frame(); };
  const denied = async (call: () => unknown, label: string) => { let failure = false; try { await call(); } catch { failure = true; } assert(failure, label); };
  return {
    checks,
    // eslint-disable-next-line max-statements, complexity -- Sequential browser interactions exercise the complete native component lifecycle.
    async run() {
      const created: string[] = [], revoked: string[] = [];
      const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
      URL.createObjectURL = blob => { const url = create(blob); created.push(url); return url; };
      URL.revokeObjectURL = url => { revoked.push(url); revoke(url); };
      try {
        open(); await until(() => !!element.querySelector('input[type="file"]'));
        const input = element.querySelector<HTMLInputElement>('input[type="file"]')!, audio = element.querySelector("audio")!;
        assert(probe.mounts === 1 && audio.controls, "real blob ESM mounts native file input and audio controls");
        assert(document.documentElement.scrollWidth <= window.innerWidth, "native component host fits the browser viewport");
        assert(requests[0]?.path === "/components/fixture/AudioPlayer?revision=component-pin" && requests[0].options?.raw, "authenticated content loader requests exact component revision");
        assert(has("标准子组件") && probe.context?.children?.textContent === "标准子组件", "standard json-render children render inside wrapper");
        assert(has("标准具名插槽") && probe.context!.slots!.footer!.textContent === "标准具名插槽", "standard named slots render into context containers");
        const files = new DataTransfer(); files.items.add(new File(["offline fixture"], "local-test.wav", { type: "audio/wav" })); input.files = files.files;
        input.dispatchEvent(new Event("change", { bubbles: true })); await until(() => has("选中文件事件已收到"));
        assert(has("local-test.wav"), "native file selection and JavaScript event reach existing json-render action");
        press("更新属性"); await until(() => has("更新标题"));
        assert(probe.mounts === 1 && element.querySelector("input") === input && input.files[0].name === "local-test.wav", "props updates preserve mount, native DOM, and selected file");
        press("组件读取"); await until(() => has("组件操作已完成"));
        const body = requests.find(request => request.path === "/call")?.options?.body;
        assert(JSON.stringify(body) === JSON.stringify({ target: "fixture.inspect", args: { filename: "local-test.wav" }, page: { module: "fixture", id: "executable", revision: "page-pin" } }), "component tool bridge uses existing page-pinned call");
        const before = requests.length, context = probe.context!;
        await denied(() => context.call("other.inspect", {}), "cross-module component call rejected");
        await denied(() => context.call("missing", {}), "undeclared component call rejected");
        await denied(() => context.emit("missing"), "undeclared component event rejected");
        assert(requests.length === before, "rejected operations never reach deps.call");
        press("触发更新错误"); await until(() => has("受控更新失败"));
        assert(probe.destroys === 1 && !element.querySelector("audio") && !element.querySelector("style"), "update failure shows error and destroys component and stylesheet");
        await denied(() => context.call("inspect", {}), "failed instance cannot call tools");
        press("重试加载组件"); await until(() => !!element.querySelector("audio"));
        assert(probe.mounts === 2, "retry loads a fresh component instance");
        const stale = probe.context!;
        let finishCall!: (value: unknown) => void; callHold = new Promise(resolve => { finishCall = resolve; });
        const pendingCall = stale.call("inspect", {}).then(() => false, () => true);
        stop(); finishCall({ text: "late result" });
        assert(await pendingCall, "tool result completing after unmount rejects as inactive"); callHold = undefined; await settle();
        assert(probe.destroys === 2 && !element.querySelector("style"), "unmount destroys instance and removes trusted style");
        await denied(() => stale.call("inspect", {}), "unmounted instance cannot call tools");
        stale.emit("selected"); assert(!element.textContent, "late emit after unmount is ignored");
        rejectLoad = true; open(); await until(() => has("受控组件读取失败"));
        rejectLoad = false; press("重试加载组件"); await until(() => !!element.querySelector("audio"));
        assert(has("初始标题"), "load failure is visible in Chinese and retry recovers");
        source = "export const missing = true;"; open(); await until(() => has("默认导出 mount"));
        assert(!element.querySelector("audio"), "missing default export fails clearly");
        source = "export default 42;"; open(); await until(() => has("默认导出 mount"));
        source = "export default () => null;"; open(); await until(() => has("必须返回清理函数"));
        source = "export default () => { throw new Error('受控挂载失败'); };"; open(); await until(() => has("受控挂载失败"));
        source = "export default (element) => { window.executableProbe.mounts++; element.textContent = '清理函数组件'; return () => window.executableProbe.destroys++; };";
        open(); await until(() => has("清理函数组件")); const count = probe.destroys; stop(); await settle();
        assert(probe.destroys === count + 1, "mount cleanup function runs once");
        source = `await new Promise(resolve => { window.executableProbe.releaseImport = resolve; }); ${javascript}`;
        const importedMounts = probe.mounts; open(); await until(() => !!probe.releaseImport); stop(); probe.releaseImport!(); await settle(); await settle();
        assert(probe.mounts === importedMounts, "late native module import cannot mount after unmount"); delete probe.releaseImport;
        let release!: (blob: Blob) => void; hold = new Promise<Blob>(resolve => { release = resolve; }); source = javascript;
        const previousRequests = requests.length, previousMounts = probe.mounts;
        open(); await until(() => requests.length > previousRequests); stop(); release(resource()); await settle(); await settle();
        assert(probe.mounts === previousMounts && !element.textContent, "late authenticated load cannot mount after unmount");
        assert(created.length > 0 && created.every(url => revoked.includes(url)) && created.length === revoked.length, "every blob module URL revoked exactly once across success, errors, retry, and unmount");
        return checks;
      } finally { stop(); URL.createObjectURL = create; URL.revokeObjectURL = revoke; element.remove(); }
    },
  };
}
Object.assign(window, { executableComponentsTest: setupExecutableComponentsTest() });
