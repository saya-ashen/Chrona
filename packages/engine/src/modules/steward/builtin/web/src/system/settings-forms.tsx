import { useState } from "react";
import { useStateStore } from "@json-render/react";
import { useAction } from "./action";
import { modelNumbers, modelValue, THINKING, type CapRow, type TierRow } from "./model-settings";
import type { GlobalSettings, ModuleModel } from "./settings";

function values(form: HTMLFormElement) {
  const result: Record<string, string> = {};
  new FormData(form).forEach((value, name) => { result[name] = String(value); });
  return result;
}
function useSaveSettings() {
  const action = useAction(), store = useStateStore(), [message, setMessage] = useState("");
  const save = (settings: Record<string, unknown>, success = "已保存") => {
    setMessage("正在保存……");
    void action.act(async () => { const saved = await action.call("settings-update", { settings }); store.set("/settingsView/settings", saved); setMessage(success); });
  };
  const fail = (message: string) => void action.act(async () => { throw new Error(message); });
  return { ...action, message, fail, save };
}
type Save = ReturnType<typeof useSaveSettings>;
function Status({ save }: { save: Save }) { return <span role={save.error ? "alert" : "status"} className={save.error ? "error" : "muted"}>{save.error || save.message}</span>; }
function NumberField({ name, label, value, min, max }: { name: string; label: string; value: number; min: number; max: number }) {
  return <label>{label} <input name={name} type="number" min={min} max={max} step={1} required defaultValue={value} /></label>;
}
export function NotificationSettings({ props: { settings } }: { props: { settings: GlobalSettings } }) {
  const save = useSaveSettings(), n = settings.notifications;
  return <form onSubmit={event => {
    event.preventDefault(); const f = values(event.currentTarget);
    if (!!f.quietStart !== !!f.quietEnd) { save.fail("请同时填写安静时段的开始和结束，或同时留空。"); return; }
    save.save({ notifications: { dailyCap: Number(f.dailyCap), quietHours: f.quietStart && f.quietEnd ? { start: f.quietStart, end: f.quietEnd } : null, timezone: f.timezone, digestAt: f.digestAt } });
  }}>
    <label>每天最多主动通知 <input name="dailyCap" type="number" min={0} max={50} defaultValue={n.dailyCap} /></label>
    <label>安静时段 <span className="fields pair"><input aria-label="安静时段开始" name="quietStart" type="time" defaultValue={n.quietHours?.start ?? ""} /><input aria-label="安静时段结束" name="quietEnd" type="time" defaultValue={n.quietHours?.end ?? ""} /></span></label>
    <label>时区 <input name="timezone" defaultValue={n.timezone} /></label>
    <label>汇总时间 <input name="digestAt" type="time" defaultValue={n.digestAt} /></label>
    <div className="row"><button className="primary" disabled={save.pending}>保存</button><Status save={save} /></div>
  </form>;
}
export function BuildSettings({ props: { settings } }: { props: { settings: GlobalSettings } }) {
  const save = useSaveSettings();
  return <form onSubmit={event => {
    event.preventDefault(); const f = values(event.currentTarget);
    save.save({ builds: { dailyLimit: Number(f.buildDailyLimit), timeoutMinutes: Number(f.buildTimeoutMinutes), maxSubmissions: Number(f.buildMaxSubmissions) } }, "已保存，下次构建生效；当前构建不受影响。");
  }}>
    <NumberField name="buildDailyLimit" label="每日新建构建上限" value={settings.builds.dailyLimit} min={0} max={200} />
    <NumberField name="buildTimeoutMinutes" label="单轮构建时限（分钟）" value={settings.builds.timeoutMinutes} min={5} max={120} />
    <NumberField name="buildMaxSubmissions" label="每轮候选提交上限" value={settings.builds.maxSubmissions} min={1} max={20} />
    <div className="row"><button className="primary" disabled={save.pending}>保存构建设置</button><Status save={save} /></div>
  </form>;
}
function TierFields({ row, change }: { row: TierRow; change: (value: TierRow) => void }) {
  return <div className="fields"><input name="tier" aria-label="档位" placeholder="档位，如 strong" autoComplete="off" value={row.tier} onChange={event => change({ ...row, tier: event.target.value })} /><input name="model" aria-label="模型" placeholder="模型，如 openai/gpt-6.1-sol" autoComplete="off" value={row.model} onChange={event => change({ ...row, model: event.target.value })} />
    <select name="thinking" aria-label="思考等级" value={row.thinking} onChange={event => change({ ...row, thinking: event.target.value })}>{THINKING.map(level => <option key={level} value={level}>{level || "默认思考"}</option>)}</select></div>;
}
function CapFields({ row, change }: { row: CapRow; change: (value: CapRow) => void }) {
  return <div className="fields pair"><input name="capModule" aria-label="模块名" placeholder="模块名" autoComplete="off" value={row.module} onChange={event => change({ ...row, module: event.target.value })} /><input name="capCalls" aria-label="每日上限" type="number" min={0} max={10000} value={row.calls} onChange={event => change({ ...row, calls: event.target.value })} /></div>;
}
function initialTiers(current: ModuleModel | null | undefined): TierRow[] {
  return Object.entries(current?.models ?? { strong: "" }).map(([tier, target]) => ({ tier, model: typeof target === "string" ? target : target.model, thinking: typeof target === "string" ? "" : target.thinking ?? "" }));
}
export function ModuleModelSettings({ props: { settings } }: { props: { settings: GlobalSettings } }) {
  const save = useSaveSettings(), current = settings.moduleModel;
  const [tiers, setTiers] = useState(() => initialTiers(current)), [caps, setCaps] = useState<CapRow[]>(() => Object.entries(current?.moduleDailyCalls ?? {}).map(([module, calls]) => ({ module, calls: String(calls) })));
  return <form onSubmit={event => {
    event.preventDefault(); const moduleModel = modelValue(tiers, caps, values(event.currentTarget));
    if (!Object.keys(moduleModel.models).length) { save.fail("至少配置一个档位"); return; }
    save.save({ moduleModel });
  }}>
    <p className="muted">模块在清单里只写档位名；这里决定每个档位用哪个模型、思考多深。</p>
    {tiers.map((row, index) => <TierFields key={index} row={row} change={value => setTiers(rows => rows.map((item, at) => at === index ? value : item))} />)}
    <div className="row"><button type="button" onClick={() => setTiers(rows => [...rows, { tier: "", model: "", thinking: "" }])}>加一个档位</button></div>
    <div className="row">{modelNumbers.map(field => <NumberField key={field.name} {...field} value={field.name === "timeoutSeconds" ? (current?.timeoutMs ?? 180000) / 1000 : current?.[field.name] ?? field.fallback} />)}</div>
    <p className="muted">单个模块的每日上限（未列出的只受合计限制；超出只停这个模块）：</p>
    {caps.map((row, index) => <CapFields key={index} row={row} change={value => setCaps(rows => rows.map((item, at) => at === index ? value : item))} />)}
    <div className="row"><button type="button" onClick={() => setCaps(rows => [...rows, { module: "", calls: "" }])}>加一个模块上限</button></div>
    <div className="row"><button className="primary" disabled={save.pending}>保存模块模型</button>{current ? <button type="button" disabled={save.pending} onClick={() => { if (globalThis.confirm("关闭后模块都不能调用模型，确定？")) save.save({ moduleModel: null }); }}>关闭模块模型</button> : null}<Status save={save} /></div>
  </form>;
}
