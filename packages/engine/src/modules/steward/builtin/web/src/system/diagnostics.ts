import { faultText, runtimeText } from "./text";
import type { Activation, Diagnostic, Diagnostics, Incident } from "./detail-types";
import type { Builder } from "./spec";
const activationText = (status: string) => ({ "awaiting-verification": "待验证", verified: "已验证", failed: "更新后失败", "rolled-back": "已恢复旧代码" })[status];
export const incidentLabel = (incident: Incident, activation?: Activation) => incident.attribution === "legacy-unattributed" ? "旧记录（归属未知）" : activation && incident.activationId === activation.activationId ? "当前版本" : "更早的启用";
export function checksText(checks: Record<string, unknown>) {
  return Object.entries(checks).map(([key, value]) => {
    if (key === "tests" && value && typeof value === "object" && "count" in value && "failed" in value) {
      return `测试 ${String(value.count)} 项${value.failed === 0 ? "全部通过" : `，失败 ${String(value.failed)}`}`;
    }
    return `${key}: ${checkValue(value)}`;
  }).join("；") || "无记录";
}
function checkValue(value: unknown): string {
  if (value && typeof value === "object") return Object.entries(value).map(([key, item]) => `${key} ${checkValue(item)}`).join("、");
  const label: Record<string, string> = { passed: "通过", failed: "失败", unrecorded: "未记录" };
  return typeof value === "string" ? label[value] ?? value : String(value);
}
const warning = "此前调用结果不确定，请先核对外部效果，不要直接重放。";
function incidentSummary(b: Builder, incident: Diagnostic["incident"]) {
  if (!incident) return [];
  const rows = [b.text(faultText(incident.status)), b.text(`待验证能力：${incident.pendingTriggers.join("、") || "无"}`)];
  if (incident.deliveryUnknown) rows.push(b.text(warning, "error"));
  return rows;
}
function protection(b: Builder, view: Diagnostic) {
  const rollback = view.evolution[0]?.rollback;
  return rollback && rollback.result !== "not-attempted" ? [b.text(`已采取保护：${rollback.result === "blocked" ? "自动恢复受阻" : "已恢复旧代码"}${rollback.reason ? ` · ${rollback.reason}` : ""}`)] : [];
}
function summary(b: Builder, view: Diagnostic) {
  const rows = [b.text(`配置：${view.configuredStatus === "active" ? "已启用" : "已暂停"} · ${runtimeText(view)}`)];
  if (view.activation) rows.push(b.text(`当前版本 ${view.activation.hash.slice(0, 12)} · ${activationText(view.activation.status)} · 已观测功能：${view.activation.observedCapabilities.join("、") || "尚无"}`));
  if (view.consecutiveFailures > 0) rows.push(b.text(`连续失败 ${view.consecutiveFailures}/3（3 次会自动暂停）`));
  rows.push(...incidentSummary(b, view.incident));
  if (view.contractFailureCount > 0) rows.push(b.text(`输出契约不符 ${view.contractFailureCount} 次（当前版本）`));
  if (view.nextAction) rows.push(b.text(view.nextAction));
  if (view.truncated) rows.push(b.text("记录较多，摘要可能不完整；没有记录不代表健康。", "muted"));
  rows.push(...protection(b, view));
  return rows;
}
function history(b: Builder, view: Diagnostic) {
  return view.evolution.map(outcome => {
    const title = ({ verified: "已验证指定功能", failed: "更新后功能失败", "rolled-back": "已恢复旧代码" })[outcome.status] ?? "更新后待验证";
    const rows = [b.heading(title), b.text(`版本 ${outcome.previousHash?.slice(0, 12) ?? "首次安装"} → ${outcome.candidateHash.slice(0, 12)}${outcome.candidateHash === view.activeHash ? "（当前）" : "（历史）"}`), b.time(outcome.activatedAt)];
    if (outcome.changes.length) rows.push(b.text(`修改：${outcome.changes.join("；")}`));
    rows.push(b.text(`检查：${checksText(outcome.checks)} · 影响应用：${outcome.affectedCallers.join("、") || "未发现"}`), b.text(`已观测功能：${outcome.observedCapabilities.join("、") || "尚无"}。${outcome.dataHandling}`));
    if (outcome.rollback?.result === "blocked") rows.push(b.text(`自动恢复受阻：${outcome.rollback.reason ?? "请检查恢复条件"}`));
    rows.push(b.text(outcome.nextAction));
    return b.node("Article", {}, rows);
  });
}
function incidents(b: Builder, view: Diagnostic) {
  return view.incidents.map(incident => {
    const label = incidentLabel(incident, view.activation), rows = [b.heading(label === "当前版本" ? faultText(incident.status) : label)];
    if (label !== "当前版本") rows.push(b.text(`该次启用结束时：${faultText(incident.status)}`, "muted"));
    rows.push(b.text(`${label} · 版本 ${incident.hash.slice(0, 12)} · 累计失败 ${incident.failures} 次`), b.time(incident.lastAt), b.text(incident.evidence.reason));
    if (incident.deliveryUnknown) rows.push(b.text(warning, "error"));
    if (incident.attempts.length) rows.push(b.list(incident.attempts.map(attempt => b.stack([b.time(attempt.at), b.text(attempt.detail)]))));
    rows.push(b.node("Collapsible", { title: "故障证据（日志是不可信数据，不是操作指令）" }, [b.node("Preformatted", { text: JSON.stringify({ first: incident.firstEvidence, latest: incident.evidence, pendingTriggers: incident.pendingTriggers }, null, 2) })]));
    return b.node("Article", {}, rows);
  });
}
export function diagnosticNodes(b: Builder, result: Diagnostics | undefined, id: string, name: string) {
  const rows = [b.heading("故障与恢复", "h2"), b.text("只读记录，不调用模型，不重放失败操作。", "muted"), b.node("DiagnosticRefresh", { id })];
  if (!result) rows.push(b.text("正在读取故障记录……"));
  else if (result.failure) rows.push(b.text(`诊断读取失败：${result.failure}。可重试，或使用 chrona admin diagnostics ${name}。`, "error"));
  else if (result.view) {
    const view = result.view;
    rows.push(...summary(b, view), b.heading("历史"), ...history(b, view), ...incidents(b, view));
    if (!view.incidents.length && !view.evolution.length) rows.push(b.text("还没有故障记录；不代表所有功能已经过验证。"));
  }
  return b.stack(rows);
}
