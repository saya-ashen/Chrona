import { useEffect, useState } from "react";
import { useStateStore } from "@json-render/react";
import { useAction } from "./action";
import type { CapRow } from "./model-settings";
import type { GlobalSettings, KernelModelCaps } from "./types";

const capNumbers = [
  { name: "maxCallsPerEvent", label: "每次事件最多调用", fallback: 3, min: 1, max: 20 },
  { name: "maxOutputTokens", label: "单次最多输出 token", fallback: 4000, min: 1, max: 32000 },
  { name: "dailyCalls", label: "全部模块每天合计", fallback: 30, min: 1, max: 10000 },
  { name: "eventTimeoutMs", label: "事件最长时间（毫秒）", fallback: 180000, min: 5000, max: 600000 },
] as const;
export function kernelCapsValue(caps: CapRow[], numbers: Record<string, string>): KernelModelCaps {
  const moduleDailyCalls = Object.fromEntries(caps.map(row => ({ ...row, module: row.module.trim() })).filter(row => row.module && row.calls !== "").map(row => [row.module, Number(row.calls)]));
  return { maxCallsPerEvent: Number(numbers.maxCallsPerEvent), maxOutputTokens: Number(numbers.maxOutputTokens), dailyCalls: Number(numbers.dailyCalls), eventTimeoutMs: Number(numbers.eventTimeoutMs), moduleDailyCalls };
}
function values(form: HTMLFormElement) {
  const result: Record<string, string> = {};
  new FormData(form).forEach((value, name) => { result[name] = String(value); });
  return result;
}
function useSaveSettings() {
  const action = useAction(), store = useStateStore(), [message, setMessage] = useState("");
  const save = (settings: Record<string, unknown>, success = "已保存") => {
    setMessage("正在保存……");
    void action.act(async () => { const saved = await action.call("settings-update", { settings }); store.set("/settingsView", saved); setMessage(success); });
  };
  return { ...action, message, save };
}
type Save = ReturnType<typeof useSaveSettings>;
function Status({ save }: { save: Save }) { return <span role={save.error ? "alert" : "status"} className={save.error ? "error" : "muted"}>{save.error || save.message}</span>; }
function NumberField({ name, label, value, min, max }: { name: string; label: string; value: number; min: number; max: number }) {
  return <label>{label} <input name={name} type="number" min={min} max={max} step={1} required defaultValue={value} /></label>;
}
export function RunTimeoutSettings({ props: { settings } }: { props: { settings: GlobalSettings } }) {
  const save = useSaveSettings();
  const [minutes, setMinutes] = useState(String(settings.runTimeoutMinutes ?? ""));
  useEffect(() => { setMinutes(String(settings.runTimeoutMinutes ?? "")); }, [settings.runTimeoutMinutes]);
  const persist = (value: string) => save.save({ runTimeoutMinutes: value === "" ? null : Number(value) }, value === "" ? "已取消任务总超时限制" : "任务总超时已保存");
  return <form onSubmit={event => { event.preventDefault(); persist(minutes); }}>
    <label>任务总超时（分钟）<input name="runTimeoutMinutes" type="number" min={1} max={525600} step={1} placeholder="留空表示不限时" value={minutes} disabled={save.pending} onChange={event => setMinutes(event.target.value)} /></label>
    <p className="muted">默认不限时。填写 1–525600 的整数；留空并保存可取消限制。仅对新启动的前台和后台任务生效，已启动的任务不受影响。</p>
    <div className="row"><button className="primary" disabled={save.pending}>保存任务总超时</button><button type="button" disabled={save.pending} onClick={() => { setMinutes(""); persist(""); }}>清除限制</button><Status save={save} /></div>
  </form>;
}
/** This form edits only the kernel budget timezone. */
export function NotificationSettings({ props: { settings } }: { props: { settings: GlobalSettings; section?: "budget" } }) {
  return <BudgetTimezone key={settings.timezone} settings={settings} />;
}
function BudgetTimezone({ settings }: { settings: GlobalSettings }) {
  const save = useSaveSettings();
  return <form onSubmit={event => { event.preventDefault(); save.save({ timezone: values(event.currentTarget).timezone }); }}>
    <label>内核预算时区<input name="timezone" defaultValue={settings.timezone} required /></label>
    <p className="muted">模块模型的每日额度按此时区重置，与通知的免打扰时段分开。</p>
    <div className="row"><button disabled={save.pending}>保存预算时区</button><Status save={save} /></div>
  </form>;
}
function CapFields({ row, change }: { row: CapRow; change: (value: CapRow) => void }) {
  return <div className="fields pair"><input name="capModule" aria-label="模块名" placeholder="模块名" autoComplete="off" value={row.module} onChange={event => change({ ...row, module: event.target.value })} /><input name="capCalls" aria-label="每日上限" type="number" min={0} max={10000} value={row.calls} onChange={event => change({ ...row, calls: event.target.value })} /></div>;
}
export function ModuleModelSettings({ props: { settings } }: { props: { settings: GlobalSettings; section?: "caps" } }) {
  return <KernelCapsSettings key={JSON.stringify(settings.moduleModel)} current={settings.moduleModel} />;
}
function KernelCapsSettings({ current }: { current: GlobalSettings["moduleModel"] }) {
  const save = useSaveSettings();
  const [caps, setCaps] = useState<CapRow[]>(() => Object.entries(current?.moduleDailyCalls ?? {}).map(([module, calls]) => ({ module, calls: String(calls) })));
  return <form onSubmit={event => { event.preventDefault(); save.save({ moduleModel: kernelCapsValue(caps, values(event.currentTarget)) }); }}>
    <p className="muted">内核限制全部模块的模型调用额度和事件时长。</p>
    <div className="row">{capNumbers.map(field => <NumberField key={field.name} {...field} value={current?.[field.name] ?? field.fallback} />)}</div>
    <p className="muted">单个模块的每日上限（未列出的只受合计限制；超出只停这个模块）：</p>
    {caps.map((row, index) => <div key={index}><CapFields row={row} change={value => setCaps(rows => rows.map((item, at) => at === index ? value : item))} /><button type="button" onClick={() => setCaps(rows => rows.filter((_, at) => at !== index))}>移除此上限</button></div>)}
    <div className="row"><button type="button" onClick={() => setCaps(rows => [...rows, { module: "", calls: "" }])}>加一个模块上限</button></div>
    <div className="row"><button className="primary" disabled={save.pending}>保存内核额度</button>{current ? <button type="button" disabled={save.pending} onClick={() => { if (globalThis.confirm("关闭后模块都不能调用模型，确定？")) save.save({ moduleModel: null }); }}>关闭模型调用额度</button> : null}<Status save={save} /></div>
  </form>;
}
