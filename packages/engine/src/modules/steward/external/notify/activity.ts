export type Activity = { id: string; at: string; kind: string; module: string | null; text: string; session?: { id: string; source: "reflect" | "build" } };
type Row = { id: string; at: string; kind: string; subject: string | null; module: string | null; hash: string | null; approvalTitle: string | null; details: Record<string, unknown> };
type Records = { rows: Row[]; before: string | null };
type Call = (target: string, args: Record<string, unknown>) => Promise<unknown>;
const SOURCES: Record<string, string> = { web: "网页", qq: "QQ", mcp: "MCP", cli: "命令行", rescue: "救援控制台", entry: "其他应用" };
const SETTINGS: Record<string, string> = { notifications: "通知", moduleModel: "模块模型", builds: "构建" };
const SIGNALS: Record<string, string> = { module_activate: "上线", module_auto_activated: "自动更新", module_runtime_incident: "出错" };
const short = (hash: unknown) => typeof hash === "string" ? hash.slice(0, 8) : "?";
function approvalText(row: Row) {
  const title = `「${row.approvalTitle ?? "已删除的审批"}」`;
  if (row.kind === "approval_created") return `生成审批${title}`;
  const source = SOURCES[String(row.details.source)] ?? "";
  return `你${row.details.decision === "approve" ? "批准" : "拒绝"}了${title}${source ? `（${source}）` : ""}`;
}
function incidentText(name: string, details: Record<string, unknown>) {
  const attempts = Array.isArray(details.attempts) ? details.attempts as { action?: string }[] : [];
  const action = attempts.at(-1)?.action;
  if (action === "connected") return `${name} 已重新连接，功能待实际调用验证`;
  if (action === "verified" || details.status === "recovered") {
    if (details.status === "verifying") return `${name} 部分能力已验证恢复，其余仍待验证`;
    return `${name} 已验证恢复（未重放失败调用${details.deliveryUnknown ? "；此前有结果未知的调用，请核对外部效果" : ""}）`;
  }
  const reason = (details.evidence as { reason?: unknown } | undefined)?.reason;
  const explanation = typeof reason === "string" ? reason.slice(0, 120) : "见诊断";
  return details.status === "unresolved"
    ? `${name} 运行出错 ${String(details.failures)} 次，自动恢复已停止：${explanation}`
    : `${name} 运行出错（第 ${String(details.failures)} 次），正在有限重启：${explanation}`;
}
function statusText(name: string, row: Row) {
  const details = row.details, paused = row.kind === "module_disabled", action = paused ? "暂停" : "恢复";
  let text = details.source === "chrona" ? `Chrona ${action}了 ${name}` : details.source === "cli" ? `你在命令行${action}了 ${name}` : `你${action}了 ${name}`;
  if (details.source === "remove") return `删除前暂停了 ${name}`;
  if (paused && details.source === "automatic") return `${name} 连续失败 3 次，已自动暂停（关联故障）`;
  if (paused && details.source === "chrona") text += `：${String(details.reason ?? "见诊断").slice(0, 120)}`;
  if (!paused && details.unrestoredLegacyPause) text += "；旧的自动暂停没有记录日程，相关日程仍保持暂停";
  return text;
}
function moduleText(row: Row) {
  const details = row.details, name = row.module ?? "已删除的应用", hash = short(details.hash ?? row.hash);
  const texts: Record<string, string> = {
    module_build_started: `开始检查 ${name} 的候选版本 ${hash}`,
    module_submission: `${name} 提交了候选版本 ${hash}`,
    module_build_settled: `${name} 的候选版本 ${hash} ${details.succeeded ? "检查完成" : "检查失败"}`,
    module_build_rejection: `${name} 的候选版本 ${hash} 未通过检查`,
    module_activate: `${name} 已切换到版本 ${hash}`,
    module_auto_activated: `${name} 已自动启用版本 ${hash}`,
    module_rollback: details.automatic === true ? `${name} 新版本启动失败，已自动回滚到 ${hash}` : `${name} 已回滚到版本 ${hash}`,
    admin_rollback: `你在命令行把 ${name} 回滚到版本 ${hash}`,
    module_migration_started: `${name} 开始迁移数据（${String(details.from)} → ${String(details.to)}）`,
    module_runtime_incident: incidentText(name, details),
    module_disabled: statusText(name, row),
    module_enabled: statusText(name, row),
    module_settings_updated: `你修改了 ${name} 的设置：${Array.isArray(details.keys) ? details.keys.join("、") : ""}`,
  };
  return { text: texts[row.kind]!, module: row.module };
}
function otherText(row: Row) {
  const details = row.details;
  if (row.kind === "grant_created") return `你新增了授权：${String(details.action ?? "")}${details.mode ? ` · ${String(details.mode)}` : ""}`;
  if (row.kind === "grant_revoked") return "你撤销了一条授权";
  if (row.kind === "settings_updated") return `你修改了设置：${(Array.isArray(details.settingsKeys) ? details.settingsKeys.map(String) : []).map(key => SETTINGS[key] ?? key).join("、")}`;
  if (row.kind === "secret_set" || row.kind === "secret_removed") return `你${row.kind === "secret_set" ? "设置" : "删除"}了凭据 ${String(details.name)}`;
  return "";
}
/** Historical reflection records retain links without reviving the retired reflection workflow. */
function reflectionText(row: Row) {
  const details = row.details, source = row.kind === "reflection_started" ? "reflect" as const : "build" as const;
  const line = (text: string) => ({ module: "reflection", text, ...(row.subject ? { session: { id: row.subject, source } } : {}) });
  if (row.kind === "reflection_started") {
    const signals = Array.isArray(details.signals) ? details.signals as { kind?: unknown; module?: unknown }[] : [];
    return line(`Chrona 反思了一次（${signals.slice(0, 3).map(signal => `${String(signal.module)} ${SIGNALS[String(signal.kind)] ?? ""}`).join("、")}${signals.length > 3 ? " 等" : ""}）`);
  }
  const modules = Array.isArray(details.modules) ? details.modules.map(String) : [];
  return line(`Chrona 开始构建「${String(details.title)}」（${modules.join("、")}）：${String(details.why)}`);
}
function describe(row: Row): Activity | null {
  if (row.kind === "grant_created" && row.details.reason) return null;
  const base = { id: row.id, at: row.at, kind: row.kind };
  if (row.kind.startsWith("approval_")) return { ...base, module: row.module, text: approvalText(row) };
  if (row.kind.startsWith("module_") || row.kind === "admin_rollback") return { ...base, ...moduleText(row) };
  return { ...base, ...(row.kind.startsWith("reflection_") ? reflectionText(row) : { module: null, text: otherText(row) }) };
}
function aggregate(rows: Row[]) {
  const lines: Activity[] = [], incidents = new Map<string, { line: Activity; count: number }>();
  for (const row of rows) {
    const line = describe(row);
    if (!line) continue;
    const id = row.kind === "module_runtime_incident" ? row.details.id : null;
    if (typeof id !== "string") { lines.push(line); continue; }
    const key = `${row.subject}:${id}`, previous = incidents.get(key);
    if (previous) previous.count++;
    else { incidents.set(key, { line, count: 1 }); lines.push(line); }
  }
  for (const { line, count } of incidents.values()) if (count > 1) line.text += `（共 ${count} 次更新）`;
  return lines;
}
/** Notify owns activity wording, incident grouping and the bounded scan policy. Audits stay immutable in the kernel. */
export async function activityView(call: Call, { module, before, limit = 50 }: { module?: string; before?: string; limit?: number }) {
  const take = Math.min(Math.max(limit, 1), 100), rows: Row[] = [];
  let cursor = before, items: Activity[] = [];
  for (let page = 0; page < 10 && items.length < take; page++) {
    const batch = await call("activity.records", { ...(cursor ? { before: cursor } : {}) }) as Records;
    rows.push(...batch.rows);
    items = aggregate(rows).filter(item => !module || item.module === module).slice(0, take);
    if (!batch.before) break;
    cursor = batch.before;
  }
  return { items, before: items.length === take ? items.at(-1)!.at : null };
}
