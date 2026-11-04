import { useState } from "react";
import { useAction } from "./action";
import type { Model, Setting, Settings, Tool } from "./detail-types";
export function settingValue(type: string, value: string, checked: boolean) { return type === "boolean" ? checked : type === "number" ? Number(value) : value; }
function SettingInput({ name, setting, value }: { name: string; setting: Setting; value: unknown }) {
  if (setting.type === "boolean") return <input name={name} type="checkbox" defaultChecked={value === true} style={{ width: "auto" }} />;
  if (setting.options) return <select name={name} defaultValue={String(value)}>{setting.options.map(option => <option key={option} value={option}>{option}</option>)}</select>;
  return <input name={name} type={setting.type === "number" ? "number" : "text"} defaultValue={String(value ?? "")} min={setting.min} max={setting.max} maxLength={setting.maxLength} step={setting.type === "number" ? "any" : undefined} />;
}
export function SettingsForm({ props }: { props: { module: string; view: Settings } }) {
  const action = useAction(), [message, setMessage] = useState("");
  const entries = Object.entries(props.view.declarations ?? {});
  if (!entries.length) return <p className="muted">这个应用没有可修改的配置。</p>;
  return <form onSubmit={event => {
    event.preventDefault(); const form = event.currentTarget;
    const values = Object.fromEntries(entries.map(([key, setting]) => { const input = form.elements.namedItem(key) as HTMLInputElement; return [key, settingValue(setting.type, input.value, input.checked)]; }));
    setMessage("正在保存……"); void action.act(async () => { await action.call("settings-save", { id: props.module, values }); setMessage("已保存，下次运行生效。"); action.refresh(); });
  }}>{entries.map(([key, setting]) => <label key={key} className={setting.type === "boolean" ? "check" : undefined}>{setting.type === "boolean" ? <SettingInput name={key} setting={setting} value={props.view.values[key]} /> : null}<strong>{setting.label}</strong>{setting.type !== "boolean" ? <SettingInput name={key} setting={setting} value={props.view.values[key]} /> : null}{setting.description ? <span className="muted">{setting.description}</span> : null}</label>)}
    <div className="row"><button className="primary" disabled={action.pending}>保存</button><span role="status" className={action.error ? "error" : "muted"}>{action.error || message}</span></div></form>;
}
export function ToolForm({ props: { tool } }: { props: { tool: Tool } }) {
  const action = useAction(), [result, setResult] = useState<string | null>(null), required = tool.inputSchema.required ?? [];
  const properties = Object.entries(tool.inputSchema.properties ?? {});
  return <form onSubmit={event => {
    event.preventDefault(); if (!tool.idempotent && !globalThis.confirm(`执行 ${tool.target}？`)) return;
    const form = event.currentTarget, args: Record<string, unknown> = {};
    for (const [name, schema] of properties) {
      const input = form.elements.namedItem(name) as HTMLInputElement;
      if (schema.type === "boolean") args[name] = input.checked;
      else if (input.value !== "") args[name] = settingValue(schema.type ?? "string", input.value, false);
    }
    setResult("执行中……"); void action.act(async () => setResult(JSON.stringify(await action.call("call", { target: tool.target, args }), null, 2)));
  }}><div><strong>{tool.target.split(".")[1]}</strong> <span className="muted">{tool.description}</span></div>
    {properties.map(([name, schema]) => <label key={name}>{name}{required.includes(name) ? " *" : ""} {schema.enum ? <select name={name}>{required.includes(name) ? null : <option value="" />}{schema.enum.map(value => <option key={String(value)} value={String(value)}>{String(value)}</option>)}</select> : <input name={name} type={schema.type === "boolean" ? "checkbox" : schema.type === "number" ? "number" : "text"} step={schema.type === "number" ? "any" : undefined} required={schema.type !== "boolean" && required.includes(name)} title={schema.description} style={schema.type === "boolean" ? { width: "auto" } : undefined} />}</label>)}
    <button className="primary" disabled={action.pending}>执行</button>{result !== null || action.error ? <pre role="status" className={action.error ? "error" : undefined}>{action.error || result}</pre> : null}</form>;
}
export function ModelCap({ props: { name, model } }: { props: { name: string; model: Model } }) {
  const action = useAction(), [message, setMessage] = useState("");
  return <div><p>档位 {model.tier}{model.target ? `（${model.target.model}${model.target.thinking ? ` · ${model.target.thinking}` : ""}）` : "（未配置）"} · 今天 {model.today.calls} 次 · 输入 {model.today.inputTokens} / 输出 {model.today.outputTokens} token</p>
    <form onSubmit={event => {
      event.preventDefault(); const value = (event.currentTarget.elements.namedItem("cap") as HTMLInputElement).value;
      void action.act(async () => {
        const result = await action.call("settings", {}) as { settings: { moduleModel?: { moduleDailyCalls?: Record<string, number> } } };
        const settings = result.settings.moduleModel;
        if (!settings) { setMessage("先在设置里配置模块模型档位。"); return; }
        const caps = { ...settings.moduleDailyCalls };
        if (value === "") delete caps[name]; else caps[name] = Number(value);
        await action.call("settings-update", { settings: { moduleModel: { ...settings, moduleDailyCalls: caps } } }); setMessage("已保存。"); action.refresh();
      });
    }}><label>每日调用上限（留空为只受全局上限） <input name="cap" type="number" min={0} max={10000} defaultValue={model.dailyCap ?? ""} /></label><div className="row"><button className="primary" disabled={action.pending}>保存</button><span role="status" className={action.error ? "error" : "muted"}>{action.error || message}</span></div></form></div>;
}
