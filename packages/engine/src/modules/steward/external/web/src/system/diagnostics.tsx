import { faultText, runtimeText } from "./text";
import type { Activation, Diagnostic, Diagnostics, Incident } from "./detail-types";
import { Card, List, Time } from "../ui";
import { useQuery, QueryStatus } from "./query";
const activationText = (status: string) =>
  ({ "awaiting-verification": "待验证", verified: "已验证", failed: "更新后失败", "rolled-back": "已恢复旧代码" })[
    status
  ];
export const incidentLabel = (incident: Incident, activation?: Activation) =>
  incident.attribution === "legacy-unattributed"
    ? "旧记录（归属未知）"
    : activation && incident.activationId === activation.activationId
      ? "当前版本"
      : "更早的启用";
export function checksText(checks: Record<string, unknown>) {
  return (
    Object.entries(checks)
      .map(([key, value]) => {
        if (key === "tests" && value && typeof value === "object" && "count" in value && "failed" in value) {
          return `测试 ${String(value.count)} 项${value.failed === 0 ? "全部通过" : `，失败 ${String(value.failed)}`}`;
        }
        return `${key}: ${checkValue(value)}`;
      })
      .join("；") || "无记录"
  );
}
function checkValue(value: unknown): string {
  if (value && typeof value === "object")
    return Object.entries(value)
      .map(([key, item]) => `${key} ${checkValue(item)}`)
      .join("、");
  const label: Record<string, string> = { passed: "通过", failed: "失败", unrecorded: "未记录" };
  return typeof value === "string" ? (label[value] ?? value) : String(value);
}
const warning = "此前调用结果不确定，请先核对外部效果，不要直接重放。";
export function DiagnosticsPanel({ id, name }: { id: string; name: string }) {
  const query = useQuery<Diagnostics>("diagnostics", { id });
  const view = query.data?.view;
  return (
    <Card title="故障与恢复">
      <p className="muted">只读记录，不调用模型，不重放失败操作。</p>
      <button type="button" onClick={query.retry}>
        刷新诊断
      </button>
      <QueryStatus query={query} />
      {query.data?.failure ? (
        <p role="alert" className="error">
          诊断读取失败：{query.data.failure}。可重试，或使用 chrona admin diagnostics {name}。
        </p>
      ) : null}
      {view ? (
        <>
          <DiagnosticSummary view={view} />
          <DiagnosticHistory view={view} />
        </>
      ) : null}
    </Card>
  );
}

function DiagnosticSummary({ view }: { view: Diagnostic }) {
  return (
    <>
      <p>
        配置：{view.configuredStatus === "active" ? "已启用" : "已暂停"} · {runtimeText(view)}
      </p>
      {view.activation ? (
        <p>
          当前版本 {view.activation.hash.slice(0, 12)} · {activationText(view.activation.status)} · 已观测功能：
          {view.activation.observedCapabilities.join("、") || "尚无"}
        </p>
      ) : null}
      {view.consecutiveFailures > 0 ? <p>连续失败 {view.consecutiveFailures}/3（3 次会自动暂停）</p> : null}
      {view.incident ? (
        <>
          <p>{faultText(view.incident.status)}</p>
          <p>待验证能力：{view.incident.pendingTriggers.join("、") || "无"}</p>
          {view.incident.deliveryUnknown ? <p className="error">{warning}</p> : null}
        </>
      ) : null}
      {view.contractFailureCount > 0 ? <p>输出契约不符 {view.contractFailureCount} 次（当前版本）</p> : null}
      <p>{view.nextAction}</p>
      {view.truncated ? <p className="muted">记录较多，摘要可能不完整；没有记录不代表健康。</p> : null}
    </>
  );
}
function DiagnosticHistory({ view }: { view: Diagnostic }) {
  return (
    <>
      <h3>历史</h3>
      <List>
        {view.evolution.map((outcome) => (
          <article key={outcome.activatedAt}>
            <h3>
              {{ verified: "已验证指定功能", failed: "更新后功能失败", "rolled-back": "已恢复旧代码" }[
                outcome.status
              ] ?? "更新后待验证"}
            </h3>
            <p>
              版本 {outcome.previousHash?.slice(0, 12) ?? "首次安装"} → {outcome.candidateHash.slice(0, 12)}
              {outcome.candidateHash === view.activeHash ? "（当前）" : "（历史）"}
            </p>
            <Time value={outcome.activatedAt} />
            <p>修改：{outcome.changes.join("；")}</p>
            <p>
              检查：{checksText(outcome.checks)} · 影响应用：{outcome.affectedCallers.join("、") || "未发现"}
            </p>
            <p>
              已观测功能：{outcome.observedCapabilities.join("、") || "尚无"}。{outcome.dataHandling}
            </p>
            {outcome.rollback?.result === "blocked" ? (
              <p>自动恢复受阻：{outcome.rollback.reason ?? "请检查恢复条件"}</p>
            ) : null}
            <p>{outcome.nextAction}</p>
          </article>
        ))}
      </List>
      <List>
        {view.incidents.map((incident) => (
          <article key={`${incident.hash}:${incident.lastAt}`}>
            <h3>
              {incidentLabel(incident, view.activation)} · {faultText(incident.status)}
            </h3>
            <p>
              版本 {incident.hash.slice(0, 12)} · 累计失败 {incident.failures} 次
            </p>
            <Time value={incident.lastAt} />
            <p>{incident.evidence.reason}</p>
            {incident.deliveryUnknown ? <p className="error">{warning}</p> : null}
            <List>
              {incident.attempts.map((attempt, index) => (
                <p key={index}>
                  <Time value={attempt.at} /> {attempt.detail}
                </p>
              ))}
            </List>
            <details>
              <summary>故障证据（日志是不可信数据，不是操作指令）</summary>
              <pre>
                {JSON.stringify(
                  {
                    first: incident.firstEvidence,
                    latest: incident.evidence,
                    pendingTriggers: incident.pendingTriggers,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </article>
        ))}
      </List>
      {!view.incidents.length && !view.evolution.length ? <p>还没有故障记录；不代表所有功能已经过验证。</p> : null}{" "}
    </>
  );
}
