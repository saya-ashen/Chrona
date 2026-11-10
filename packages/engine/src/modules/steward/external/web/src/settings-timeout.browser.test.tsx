// Offline global Settings fixture; exercised by settings-timeout.bun.test.ts.
import { mountSystem } from "./pages";
import type { SystemHost } from "./system/adapter";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function until(check: () => boolean) {
  for (let i = 0; i < 180; i++) { if (check()) return; await frame(); }
  throw new Error("Timeout settings did not settle");
}
async function run() {
  const checks: string[] = [];
  const assert = (condition: unknown, label: string) => { if (!condition) throw new Error(label); checks.push(label); };
  const element = document.createElement("main"); document.body.append(element);
  const input = () => element.querySelector<HTMLInputElement>('input[name="runTimeoutMinutes"]')!;
  const form = () => input().form!;
  const button = (label: string) => Array.from(form().querySelectorAll("button")).find(item => item.textContent === label)!;
  const has = (text: string) => element.textContent.includes(text);
  const draft = async (value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
    await frame();
  };
  const patches: Record<string, unknown>[] = [];
  let runTimeoutMinutes: number | null = null, fail = false;
  const loading = deferred();
  let pending: ReturnType<typeof deferred> | undefined;
  const host: SystemHost = {
    async web(path, options) {
      if (path === "/pages" || path === "/modules") return [];
      if (path !== "/settings") throw new Error(`Unexpected path ${path}`);
      if (options?.method === "POST") {
        const patch = options.body as { runTimeoutMinutes: number | null }; patches.push(patch);
        if (pending) await pending.promise;
        if (fail) throw new Error("受控保存失败，请重试");
        runTimeoutMinutes = patch.runTimeoutMinutes;
      } else await loading.promise;
      return { settings: { timezone: "UTC", runTimeoutMinutes, moduleModel: null, modelUsage: [] } };
    },
    tool: async () => { throw new Error("Settings must use its Web proxy"); },
    login: async () => { throw new Error("Settings must not log in"); },
  };
  let unmount = mountSystem(element, { name: "settings" }, host, () => {});
  try {
    await until(() => has("正在读取内核设置"));
    assert(!input() && patches.length === 0, "loading does not show a premature form or save a default");
    loading.resolve(); await until(() => !!input());
    assert(input().value === "" && patches.length === 0, "default unlimited is blank and never written on mount");
    assert(input().labels?.[0]?.textContent === "任务总超时（分钟）", "timeout has its Chinese accessible label");
    assert(has("默认不限时") && has("仅对新启动的前台和后台任务生效") && has("已启动的任务不受影响"), "scope and unlimited behavior are explicit");
    assert(!input().required && input().placeholder === "留空表示不限时", "blank is allowed and explains unlimited");
    assert(document.documentElement.scrollWidth <= window.innerWidth, "settings fits the viewport without horizontal scrolling");
    for (const invalid of ["0", "-1", "1.5", "525601"]) {
      await draft(invalid);
      button("保存任务总超时").click(); await frame();
      assert(!input().checkValidity() && patches.length === 0, `invalid ${invalid} cannot save`);
    }
    await draft("45"); pending = deferred();
    button("保存任务总超时").click(); await until(() => patches.length === 1);
    await until(() => input().disabled);
    assert(button("保存任务总超时").disabled && button("清除限制").disabled && has("正在保存"), "pending save disables editing and both actions");
    pending.resolve(); pending = undefined; await until(() => has("任务总超时已保存"));
    assert(JSON.stringify(patches[0]) === '{"runTimeoutMinutes":45}' && input().value === "45", "save sends only the explicit timeout and shows success");
    unmount(); unmount = mountSystem(element, { name: "settings" }, host, () => {});
    await until(() => input()?.value === "45");
    assert(patches.length === 1, "reopening loads the saved timeout without writing");
    await draft(""); button("保存任务总超时").click(); await until(() => has("已取消任务总超时限制"));
    assert(patches[1]?.runTimeoutMinutes === null && input().value === "", "saving an empty field explicitly clears with null");
    await draft("525600"); button("保存任务总超时").click(); await until(() => has("任务总超时已保存"));
    assert(patches[2]?.runTimeoutMinutes === 525600, "maximum allowed timeout saves");
    button("清除限制").click(); await until(() => has("已取消任务总超时限制"));
    assert(patches[3]?.runTimeoutMinutes === null && input().value === "", "clear action removes the saved limit");
    await draft("1"); fail = true; button("保存任务总超时").click();
    await until(() => !!form().querySelector('[role="alert"]'));
    assert(has("受控保存失败，请重试") && input().value === "1" && !button("保存任务总超时").disabled, "failed save preserves the draft and offers retry");
    fail = false; button("保存任务总超时").click(); await until(() => has("任务总超时已保存"));
    assert(!form().querySelector('[role="alert"]') && patches.at(-1)?.runTimeoutMinutes === 1, "retry saves the minimum timeout and clears the error");
    unmount(); unmount = mountSystem(element, { name: "settings" }, host, () => {});
    await until(() => input()?.value === "1");
    button("清除限制").click(); await until(() => has("已取消任务总超时限制"));
    unmount(); unmount = mountSystem(element, { name: "settings" }, host, () => {});
    await until(() => !!input());
    assert(input().value === "", "cleared timeout remains unlimited after reopening");
    return checks;
  } catch (error) {
    throw new Error(`${(error as Error).message}; last check: ${checks.at(-1)}; DOM: ${element.textContent}`, { cause: error });
  } finally { unmount(); element.remove(); }
}
Object.assign(window, { timeoutSettingsTest: { run } });
