import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SystemContext } from "./system/action";
import { useQuery, QueryStatus } from "./system/query";
import { TodayPage } from "./system/today";
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function until(check: () => boolean) {
  for (let i = 0; i < 120; i++) { if (check()) return; await frame(); }
  throw new Error("Browser state did not settle");
}
function deferred() {
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
export function setupPageLoadingTest() {
  const element = document.body.appendChild(document.createElement("main")), requests: ReturnType<typeof deferred>[] = [], checks: string[] = [];
  const assert = (condition: unknown, label: string) => { if (!condition) throw new Error(label); checks.push(label); };
  function Content() {
    const first = useQuery<{ text: string }>("first"), second = useQuery<{ text: string }>("second");
    return <><QueryStatus query={first} /><p>{first.data?.text}</p>
      <QueryStatus query={second} /><p>{second.data?.text}</p><button onClick={() => { first.retry(); second.retry(); }}>刷新测试数据</button></>;
  }
  function Host() {
    const [revision] = useState(0);
    const call = async () => { const request = deferred(); requests.push(request); return request.promise; };
    return <SystemContext.Provider value={{ revision, refresh: () => {}, call }}><Content /></SystemContext.Provider>;
  }
  const root = createRoot(element); root.render(<Host />);
  return { checks,
    async run() {
      await until(() => requests.length === 2); assert(element.textContent.includes("加载中"), "independent sources expose loading");
      requests[0]!.resolve({ text: "工作列表已恢复" }); await until(() => element.textContent.includes("工作列表已恢复")); assert(element.textContent.includes("加载中"), "one response cannot hide another pending query");
      requests[1]!.resolve({ text: "叶任务列表已恢复" }); await until(() => !element.textContent.includes("加载中")); assert(element.textContent.includes("叶任务列表已恢复"), "both responses render");
      element.querySelector("button")!.click(); await until(() => requests.length === 4);
      requests[2]!.reject(new Error("受控读取失败")); requests[3]!.resolve({ text: "刷新后的叶任务" });
      await until(() => element.textContent.includes("受控读取失败")); assert(element.textContent.includes("刷新后的叶任务"), "failure remains visible beside successful data");
      root.unmount();
      const reads = new Map<string, ReturnType<typeof deferred>>();
      const call = async (tool: string) => { const request = deferred(); reads.set(tool, request); return request.promise; };
      const todayRoot = createRoot(element);
      todayRoot.render(<SystemContext.Provider value={{ call, refresh: () => {} }}><TodayPage /></SystemContext.Provider>);
      await until(() => reads.size === 3);
      reads.get("today")!.resolve({approvals:[],problems:[],upcoming:[],updates:[],apps:[],sessions:[]});
      await until(() => element.textContent.includes("没有待处理的事项"));
      assert(element.textContent.includes("加载中"), "Today content renders while runtime and runs remain pending");
      reads.get("runtime")!.reject(new Error("受控健康探测失败"));
      await until(() => element.textContent.includes("受控健康探测失败"));
      assert(element.textContent.includes("没有待处理的事项"), "runtime failure does not hide Today content");
      reads.get("runs")!.resolve([{id:"pending-run",active:true,status:"running",sessionTitle:"实际正在处理",interactions:[]}]);
      await until(() => element.textContent.includes("实际正在处理"));
      assert(element.textContent.includes("停止"), "runs remain actionable beside a runtime error");
      assert(document.documentElement.scrollWidth <= innerWidth, "Today has no horizontal overflow");
      todayRoot.unmount(); element.remove(); return checks;
    },
  };
}
Object.assign(window, { pageLoadingTest: setupPageLoadingTest() });
