// Browser regression fixture: bundle this entry, serve it on loopback, then call pageLoadingTest.run().
import { mount, type Page } from "./pages";

function deferred() {
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function until(check: () => boolean) {
  for (let i = 0; i < 120; i++) { if (check()) return; await frame(); }
  throw new Error("Browser state did not settle");
}
const page: Page = {
  module: "fixture", id: "loading", title: "PageView loading regression", data: { first: { tool: "first" }, second: { tool: "second" } },
  spec: { root: "root", state: { first: { text: "已有工作列表" } }, elements: {
    root: { type: "Stack", props: {}, children: ["first", "second", "refresh"] },
    first: { type: "Text", props: { text: { $state: "/first/text" } } },
    second: { type: "Text", props: { text: { $state: "/second/text" } } },
    refresh: { type: "Button", props: { label: "刷新测试数据" }, on: { press: { action: "call", params: { tool: "refresh" } } } },
  } },
};
export function setupPageLoadingTest() {
  const element = document.createElement("main"); document.body.append(element);
  const requests: { target: string; result: ReturnType<typeof deferred> }[] = [];
  let unmount = mount(element, page, {
    call: async target => {
      if (target === "fixture.refresh") return {};
      const result = deferred(); requests.push({ target, result }); return result.promise;
    }, navigate: () => {}, content: async () => new Blob(),
  });
  const initial = () => element.textContent.includes("正在读取应用数据……");
  const refreshing = () => element.textContent.includes("正在刷新应用数据……");
  const loading = () => initial() || refreshing();
  const has = (text: string) => element.textContent.includes(text);
  const checks: string[] = [];
  const assert = (value: boolean, label: string) => { if (!value) throw new Error(label); checks.push(label); };
  return {
    checks,
    async pending() { await until(() => requests.length === 2 && initial()); assert(has("已有工作列表"), "pending preserves previous work"); },
    async partial() { requests[0]!.result.resolve({ text: "工作列表已恢复" }); await until(() => has("工作列表已恢复")); assert(loading(), "first response does not hide second pending source"); },
    async complete() { requests[1]!.result.resolve({ text: "叶任务列表已恢复" }); await until(() => !loading() && has("叶任务列表已恢复")); assert(has("工作列表已恢复"), "both successful source results visible"); },
    async refresh() { element.querySelector("button")!.click(); await until(() => requests.length === 4 && refreshing() && !initial()); assert(has("工作列表已恢复") && has("叶任务列表已恢复"), "refresh keeps existing lists"); },
    async error() { requests[2]!.result.reject(new Error("受控读取失败")); await until(() => has("受控读取失败")); assert(loading(), "error does not hide other pending source"); requests[3]!.result.resolve({ text: "刷新后的叶任务" }); await until(() => !loading() && has("刷新后的叶任务")); assert(has("工作列表已恢复") && has("受控读取失败"), "failed refresh preserves old data and visible error"); },
    async missing() {
      unmount(); let calls = 0;
      unmount = mount(element, { ...page, data: { first: { tool: "first" } }, needs: { first: ["required"] } }, { call: async () => { calls++; return {}; }, navigate: () => {}, content: async () => new Blob() });
      await frame(); await frame(); assert(calls === 0 && !loading(), "missing required args do not request or leave loading");
    },
    async run() { await this.pending(); await this.partial(); await this.complete(); await this.refresh(); await this.error(); await this.missing(); return checks; },
  };
}
Object.assign(window, { pageLoadingTest: setupPageLoadingTest() });
