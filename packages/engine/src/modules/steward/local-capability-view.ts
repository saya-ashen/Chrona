import { z } from "zod";
import type { StewardPorts } from "./ports";
import { listLocalModules } from "./module-calls";
import { registerLocalRuntime } from "./local-runtime";
import { registerWorkspaceModule } from "./local-workspace";
import { registerContentModule } from "./local-content";

export const runtimeCapabilitySchema = z.object({
  status: z.enum(["registered", "configured", "unconfigured"]), backend: z.string().nullable(),
  responsibility: z.string(), configuration: z.string(),
});
const descriptions: Record<string, { responsibility: string; configuration: string }> = {
  "runtime-callback": { responsibility: "把 Agent 的进度、用量、工具事件和问答回传给对应运行。回调引用绑定工作空间，并随运行结束释放。", configuration: "由 Chrona 按运行自动建立，无需单独配置。" },
  "workspace-local": { responsibility: "准备本机项目工作目录、处理锁与项目规则、捕获成果并执行受治理的清理。", configuration: "项目访问范围与执行位置通过宿主的 execution-projects.json 配置；此页不显示本机路径，也不修改项目授权。" },
  "content-local": { responsibility: "保存和读取本机附件及不可变内容，检查归属、大小与文件引用。应用通过引用使用内容。", configuration: "使用当前 Chrona 数据目录的本机存储，随服务数据目录配置。更换目录应使用完整备份与恢复流程。" },
};
export function localCapabilities() {
  registerLocalRuntime(); registerWorkspaceModule(); registerContentModule();
  return listLocalModules().filter(module => module.name !== "agent");
}
export function localCapabilityView(_ports: StewardPorts, name: string) {
  const description = descriptions[name];
  if (!description) return undefined;
  return { ...description, status: "registered" as const, backend: null };
}
