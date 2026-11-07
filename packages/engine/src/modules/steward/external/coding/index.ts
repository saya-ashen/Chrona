import { on, chrona } from "chrona";
import { CODING_TOOL_OPERATIONS, parseCodingToolInput } from "./contract.js";
import { createCodingWork, getCodingWork, listCodingWorks, sendCodingWork, answerCodingWork, cancelCodingWork } from "./work";
import { codingError, type CodingContext } from "./storage";
import { reconcileWorks } from "./work-v2";
import { handleWorkTool } from "./work-v2-tools";
import { listCodingResults, acceptCodingResult } from "./results";

const context: CodingContext = { dir: chrona.paths.data, content: chrona.paths.content, call: (target, args) => chrona.call(target, args) };
export const PAGE = {
  id: "main", title: "编码工作",
  data: {
    list: { tool: "list", args: { input: JSON.stringify({ limit: 100 }) } },
    worklist: { tool: "work", args: { input: JSON.stringify({ v: "chrona.execution.v2", requestId: "coding-page", command: { op: "list", resource: "works", limit: 20 } }) } },
  },
  spec: { root: "all", elements: {
    all: { type: "Stack", props: { gap: "lg" }, children: ["v2", "works"] },
    v2: { type: "Card", props: { title: "多位置编码工作" }, children: ["v2help", "v2empty", "v2items"] },
    v2help: { type: "Text", props: { text: "在对话或编辑器中选择执行位置、明确基线和工作树，再提交单工作或父子图。依赖只传递成果引用，不自动应用代码；接受成果不会合并或清理工作树。", variant: "muted" }, children: [] },
    v2empty: { type: "Text", props: { text: "还没有多位置工作。请先选择已授权位置，再创建工作。", variant: "muted" }, visible: { $state: "/worklist/works/length", eq: 0 }, children: [] },
    v2items: { type: "Stack", props: { gap: "md" }, repeat: { statePath: "/worklist/works", key: "workId" }, children: ["v2id", "v2goal", "v2project", "v2expires", "phase-waiting_dependency", "phase-waiting_device", "phase-queued", "phase-running", "phase-stopping", "phase-unknown", "phase-completed", "phase-failed", "phase-cancelled"] },
    v2id: { type: "Heading", props: { text: { $item: "workId" }, level: "h3" }, children: [] },
    v2goal: { type: "Text", props: { text: { $item: "goal" } }, children: [] },
    v2project: { type: "Text", props: { text: { $item: "placement/projectRef" }, variant: "muted" }, visible: { $item: "placement/projectRef" }, children: [] },
    v2expires: { type: "Time", props: { value: { $item: "queueExpiresAt" } }, visible: { $item: "queueExpiresAt" }, children: [] },
    "phase-waiting_dependency": { type: "Text", props: { text: "等待前置成果。查看被阻塞的子工作；前置失败、未知或缺成果时不会派发。" }, visible: { $item: "phase", eq: "waiting_dependency" }, children: [] },
    "phase-waiting_device": { type: "Text", props: { text: "等待设备上线。尚未启动，不会自动改派；可刷新或取消排队。" }, visible: { $item: "phase", eq: "waiting_device" }, children: [] },
    "phase-queued": { type: "Text", props: { text: "等待执行名额。可刷新或取消排队。" }, visible: { $item: "phase", eq: "queued" }, children: [] },
    "phase-running": { type: "Text", props: { text: "正在执行。可打开精确子工作查看进度、答复问题或请求停止。" }, visible: { $item: "phase", eq: "running" }, children: [] },
    "phase-stopping": { type: "Text", props: { text: "已请求停止，尚未确认。请刷新核对；工作树仍可能写入，不可清理。" }, visible: { $item: "phase", eq: "stopping" }, children: [] },
    "phase-unknown": { type: "Text", props: { text: "执行结果未知。请核对停止证据或请求停止，不要重跑或清理目录。" }, visible: { $item: "phase", eq: "unknown" }, children: [] },
    "phase-completed": { type: "Text", props: { text: "执行已完成。下一步查看并验收精确成果版本；工作树默认保留。" }, visible: { $item: "phase", eq: "completed" }, children: [] },
    "phase-failed": { type: "Text", props: { text: "执行失败。下一步查看已知成果与错误；不会自动重跑。" }, visible: { $item: "phase", eq: "failed" }, children: [] },
    "phase-cancelled": { type: "Text", props: { text: "已确认取消。可查看保留成果；取消不会删除工作树。" }, visible: { $item: "phase", eq: "cancelled" }, children: [] },
    works: { type: "Card", props: { title: "服务器编码工作" }, children: ["help", "empty", "items"] },
    help: { type: "Text", props: { text: "执行完成后查看 results 成果版本；content.read 可读取 coding/<artifactRef>.json。用 accept 明确接受，接受不会提交或合并代码。", variant: "muted" }, children: [] },
    empty: { type: "Text", props: { text: "还没有编码工作。请通过对话或编辑器创建工作，并指定已授权的项目引用。", variant: "muted" }, visible: { $state: "/list/works/length", eq: 0 }, children: [] },
    items: { type: "Stack", props: { gap: "md" }, repeat: { statePath: "/list/works", key: "workId" }, children: ["id", "project", "status", "cancel"] },
    id: { type: "Heading", props: { text: { $item: "workId" }, level: "h3" }, children: [] },
    project: { type: "Text", props: { text: { $item: "projectRef" }, variant: "muted" }, children: [] },
    status: { type: "Text", props: { text: { $item: "status" } }, children: [] },
    cancel: { type: "Text", props: { text: "已请求停止，等待停止证据。", variant: "muted" }, visible: { $item: "cancelRequested", eq: true }, children: [] },
  } },
};
async function reportReadiness() {
  try {
    const result = await chrona.call("executions.locations", { limit: 100 }) as { locations: { online: boolean }[] };
    const available = result.locations.length > 0, online = result.locations.some(location => location.online);
    await chrona.reportHealth({ status: !available ? "needs_configuration" : online ? "ready" : "degraded",
      summary: !available ? "尚未配置已授权的编码位置" : online ? "编码位置已配置；具体执行仍需检查基线与预算" : "已配置的编码位置当前均离线",
      nextAction: !available ? "配置项目访问权限和执行位置后再创建编码工作" : online ? "创建编码工作时选择已授权项目" : "恢复执行位置连接后重新自检", validForSeconds: 600 });
  } catch (error) {
    const unavailable = (error as { code?: string }).code === "unavailable";
    await chrona.reportHealth({ status: unavailable ? "needs_configuration" : "unknown", summary: unavailable ? "编码位置服务尚不可用" : "暂时无法读取编码位置",
      nextAction: unavailable ? "配置项目访问权限和执行位置；已配置时检查服务运行状态" : "查看运行诊断后重试", validForSeconds: 600 });
  }
}
on("health", async () => { await reportReadiness(); return {}; });
on("activated", async () => {
  await chrona.call("web.page-set", PAGE);
  await chrona.call("schedules.create", { key: "coding-dependencies", rule: JSON.stringify({ kind: "every", minutes: 5 }), payload: "{}", label: "核对编码工作前置成果" });
  await reconcileWorks(context);
  await reportReadiness();
  return {};
});
on("schedule", async () => { await reconcileWorks(context); await reportReadiness(); return {}; });
function admit(event: { id: string; caller?: { kind: string }; args: Record<string, unknown> }) {
  // Kernel owner visibility admits real uses:* entries without changing their module identity.
  if (!["owner", "provider", "module"].includes(event.caller?.kind ?? "")) throw codingError("forbidden", "Coding requires an admitted owner or provider caller");
  if (event.id === "accept" && event.caller?.kind === "provider") throw codingError("forbidden", "Only the owner may accept a coding result");
  if (!Object.hasOwn(CODING_TOOL_OPERATIONS, event.id) || typeof event.args.input !== "string") throw codingError("invalid", "Invalid coding tool input");
}
on("tool", async event => {
  if (["work", "workspace-cleanup", "reconcile"].includes(event.id)) return { result: await handleWorkTool(context, event) };
  admit(event);
  const input = event.args.input as string;
  // Each actual ingress decodes the public schema once; the work helpers consume typed values.
  function parsed<K extends keyof typeof CODING_TOOL_OPERATIONS>(name: K) {
    try { return parseCodingToolInput(name, input); }
    catch { throw codingError("invalid", "Invalid coding tool input"); }
  }
  switch (event.id) {
    case "create": return { result: await createCodingWork(context, parsed("create")) };
    case "get": return { result: await getCodingWork(context, parsed("get")) };
    case "list": return { result: await listCodingWorks(context, parsed("list")) };
    case "send": return { result: await sendCodingWork(context, parsed("send")) };
    case "answer": return { result: await answerCodingWork(context, parsed("answer")) };
    case "cancel": return { result: await cancelCodingWork(context, parsed("cancel")) };
    case "results": return { result: await listCodingResults(context, parsed("results")) };
    case "accept": return { result: await acceptCodingResult(context, parsed("accept")) };
  }
});
