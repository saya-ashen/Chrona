import { useState } from "react";
import { useAction } from "./action";
import type { Tool } from "./detail-types";

export function settingValue(type: string, value: string, checked: boolean) { return type === "boolean" ? checked : type === "number" ? Number(value) : value; }
export function toolArguments(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("参数必须是 JSON 对象。");
  return value as Record<string, unknown>;
}
export function ToolContract({ props: { tool } }: { props: { tool: Tool } }) {
  return <details><summary>{tool.target} · {tool.description}</summary>
    <p className="muted">{tool.idempotent ? "声明为幂等操作" : "未声明为幂等操作"}{tool.retry ? ` · ${tool.retry}` : ""}</p>
    <strong>输入合同</strong><pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
    {tool.outputSchema ? <><strong>输出合同</strong><pre>{JSON.stringify(tool.outputSchema, null, 2)}</pre></> : null}
    {tool.examples?.length ? <><strong>示例</strong><pre>{JSON.stringify(tool.examples, null, 2)}</pre></> : null}
    {tool.sideEffects?.length ? <p>副作用：{tool.sideEffects.join("；")}</p> : null}
    {tool.errors?.length ? <><strong>可能的错误</strong><pre>{JSON.stringify(tool.errors, null, 2)}</pre></> : null}
  </details>;
}
export function ToolForm({ props: { tool } }: { props: { tool: Tool } }) {
  const action = useAction(), [result, setResult] = useState<string | null>(null), [args, setArgs] = useState("{}");
  return <form onSubmit={event => {
    event.preventDefault();
    void action.act(async () => {
      const input = toolArguments(args);
      if (!tool.idempotent && !globalThis.confirm(`执行 ${tool.target}？`)) return;
      setResult("执行中……");
      const output = await action.call("call", { target: tool.target, args: input });
      setResult(output === undefined ? "未返回结果，请查看状态后再决定是否重试。" : JSON.stringify(output, null, 2));
    });
  }}><label>{tool.target} 参数（JSON 对象）<textarea rows={5} value={args} spellCheck={false} onChange={event => setArgs(event.target.value)} /></label>
    <button className="primary" disabled={action.pending}>执行 {tool.target}</button>
    {result !== null || action.error ? <pre role={action.error ? "alert" : "status"} className={action.error ? "error" : undefined}>{action.error || result}</pre> : null}
  </form>;
}
