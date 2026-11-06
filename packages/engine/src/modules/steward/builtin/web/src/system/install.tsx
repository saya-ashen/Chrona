import { useEffect, useState } from "react";
import type { ModuleInstallRequest, ModuleInstallResult } from "@chrona/contracts/steward";
import { useAction } from "./action";

const installationLabels: Record<string, string> = { pending: "已受理，结果待核对", building: "检查中", pending_approval: "待你确认", installed: "代码已安装", failed: "安装失败", unavailable: "安装暂不可用" };
export const installationText = (status: string) => installationLabels[status] ?? status;
export function installationRequest(name: ModuleInstallRequest["package"], mode: ModuleInstallRequest["mode"], storage: Pick<Storage, "getItem" | "setItem"> | undefined = installationStorage()): ModuleInstallRequest {
  const key = `chrona.install.${name}.${mode}`, requestKey = storage?.getItem(key) ?? crypto.randomUUID();
  storage?.setItem(key, requestKey);
  return { package: name, mode, requestKey };
}
export function settleInstallation(result: ModuleInstallResult, mode: ModuleInstallRequest["mode"], storage: Pick<Storage, "getItem" | "removeItem"> | undefined = installationStorage()) {
  const key = `chrona.install.${result.package}.${mode}`;
  if (["installed", "failed", "unavailable"].includes(result.status) && storage?.getItem(key) === result.requestKey) storage.removeItem(key);
}
type InstallProps = { name: ModuleInstallRequest["package"]; mode: ModuleInstallRequest["mode"]; retry?: boolean; completedRequestKey?: string };
// sessionStorage may be absent in non-browser renderers.
const installationStorage = (): Storage | undefined => globalThis.sessionStorage;
function savedRequest(props: InstallProps) {
  const storageKey = `chrona.install.${props.name}.${props.mode}`, storage = installationStorage();
  const key = storage?.getItem(storageKey) ?? null;
  if (key && key === props.completedRequestKey) { storage?.removeItem(storageKey); return null; }
  return key;
}
function installationLabel(pending: boolean, unknown: boolean, props: InstallProps, receipt: ModuleInstallResult | null) {
  if (pending) return "提交中……";
  if (unknown) return "用原请求核对";
  if (props.retry || receipt?.status === "failed" || receipt?.status === "unavailable") return "明确重试";
  return props.mode === "update" ? "明确更新" : "安装";
}
export function PackageInstall({ props }: { props: InstallProps }) {
  const storageKey = `chrona.install.${props.name}.${props.mode}`;
  const saved = () => savedRequest(props);
  const action = useAction(), [request, setRequest] = useState<ModuleInstallRequest | null>(() => { const key = saved(); return key ? { package: props.name, mode: props.mode, requestKey: key } : null; }), [receipt, setReceipt] = useState<ModuleInstallResult | null>(null);
  const [unknown, setUnknown] = useState(() => !!saved());
  useEffect(() => {
    if (props.completedRequestKey && request?.requestKey === props.completedRequestKey) {
      installationStorage()?.removeItem(storageKey); setRequest(null); setReceipt(null); setUnknown(false);
    }
  }, [props.completedRequestKey, request?.requestKey]);
  const submit = () => void action.act(async () => {
    if (!request && props.mode === "update" && !globalThis.confirm(`明确更新 ${props.name}？这会以官方发行包替换当前代码，包括已有定制。`)) return;
    const next = request ?? installationRequest(props.name, props.mode);
    setRequest(next); setUnknown(true);
    const result = await action.call("install", next) as ModuleInstallResult;
    setReceipt(result); setUnknown(false);
    settleInstallation(result, props.mode);
    if (["installed", "failed", "unavailable"].includes(result.status)) setRequest(null);
    action.refresh();
  });
  const unresolved = unknown || !!receipt && ["pending", "building", "pending_approval"].includes(receipt.status);
  return <div>
    <button type="button" disabled={action.pending || !!receipt && !["failed", "unavailable"].includes(receipt.status)} onClick={submit}>{installationLabel(action.pending, unknown, props, receipt)} {props.name}</button>
    {receipt ? <p role="status">{installationText(receipt.status)}{receipt.error ? `：${receipt.error.message}` : ""}</p> : null}
    {unresolved ? <p role="status">请求已保存，尚未确认完成；刷新查看状态，不会自动重新安装。</p> : null}
    {receipt?.approvalId ? <a href="/">前往待你决定</a> : null}
    {action.error ? <p role="alert" className="error">{action.error}；结果未确认，请用原请求核对。</p> : null}
  </div>;
}
