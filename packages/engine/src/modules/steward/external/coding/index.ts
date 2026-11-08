import { PAGE } from "./page";
import { workbenchCatalog, workbenchDetail, workbenchCommand } from "./workbench";
import { codingSessions } from "./sessions";
import { callAgent } from "./agent";
import { lookupCodingWork } from "./storage";
import { on, chrona } from "chrona";
import { CODING_TOOL_OPERATIONS, parseCodingToolInput } from "./contract.js";
import { createCodingWork, getCodingWork, listCodingWorks, sendCodingWork, answerCodingWork, cancelCodingWork } from "./work";
import { codingError, type CodingContext } from "./storage";
import { reconcileWorks } from "./work-v2";
import { handleWorkTool } from "./work-v2-tools";
import { listCodingResults, acceptCodingResult } from "./results";

const context: CodingContext = { dir: chrona.paths.data, content: chrona.paths.content, call: (target, args) => chrona.call(target, args) };
export { PAGE } from "./page";
async function reportReadiness() {
  try {
    const result = await chrona.call("agent.locations", { limit: 100 }) as { locations: { online: boolean }[] };
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
  const special = await specialCommand(event);
  if (special) return special;
  return codingCommand(event);
});
async function codingCommand(event: Parameters<typeof admit>[0]) {
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
    case "lookup-start": {
      const args = parsed("lookup-start");
      return { result: await callAgent(context, "lookup-start", args) };
    }
    case "events": return { result: await readScopedExecution("events", parsed("events")) };
    case "snapshot": return { result: await readScopedExecution("snapshot", parsed("snapshot")) };
    case "list": return { result: await listCodingWorks(context, parsed("list")) };
    case "send": return { result: await sendCodingWork(context, parsed("send")) };
    case "answer": return { result: await answerCodingWork(context, parsed("answer")) };
    case "cancel": return { result: await cancelCodingWork(context, parsed("cancel")) };
    case "results": return { result: await listCodingResults(context, parsed("results")) };
    case "accept": return { result: await acceptCodingResult(context, parsed("accept")) };
  }
}

async function sessionCommand(event: Parameters<typeof admit>[0]) {
    if (!["owner", "provider", "module"].includes(event.caller?.kind ?? "") || typeof event.args.input !== "string" || event.args.input.length > 4096) throw codingError("invalid", "Invalid coding session command");
    let args: unknown; try { args = JSON.parse(event.args.input); } catch { throw codingError("invalid", "Expected session JSON"); }
    return { result: await codingSessions(context, args) };
  }

async function readScopedExecution(name: "events" | "snapshot", args: { workId: string; runId: string; attemptId: string }) {
  const { view } = await lookupCodingWork(context, args);
  if (view.runId !== args.runId || view.attemptId !== args.attemptId) throw codingError("conflict", "Execution reference changed");
  return callAgent(context, name, args);
}

async function specialCommand(event: Parameters<typeof admit>[0]) {
  if (event.id.startsWith("ui-")) {
    if (!["owner", "module"].includes(event.caller?.kind ?? "")) throw codingError("forbidden", "网页操作仅向用户开放。");
    if (event.id === "ui-catalog") return { result: await workbenchCatalog(context) };
    if (event.id === "ui-work") return { result: await workbenchDetail(context, String(event.args["work-id"] ?? "")) };
    if (event.id === "ui-command") return { result: await workbenchCommand(context, event.args) };
  }
  if (event.id === "sessions") return sessionCommand(event);
  if (["work", "workspace-cleanup", "reconcile"].includes(event.id)) return { result: await handleWorkTool(context, event) };
  return null;
}
