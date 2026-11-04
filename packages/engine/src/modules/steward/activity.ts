import type { StewardPorts } from "./ports";

/**
 * v2-18: what Chrona did that the user cares about, one sentence each, from the kernel's audit trail. Only the kernel
 * reads audits and words them, so a module (the page included) can show the record but never write or reword it.
 */
const KINDS = ["approval_created", "approval_resolved", "module_build_started", "module_submission", "module_build_settled", "module_build_rejection",
  "module_activate", "module_auto_activated", "module_rollback", "admin_rollback", "module_migration_started", "module_runtime_incident", "module_disabled", "module_enabled",
  "grant_created", "grant_revoked", "settings_updated", "secret_set", "secret_removed", "reflection_started", "reflection_suggested", "module_settings_updated"] as const;
const SOURCES: Record<string, string> = { web: "网页", qq: "QQ", mcp: "MCP", cli: "命令行", rescue: "救援控制台", entry: "其他应用" };
const SETTINGS: Record<string, string> = { notifications: "通知", moduleModel: "模块模型", builds: "构建" };
const SIGNALS: Record<string, string> = { module_activate: "上线", module_auto_activated: "自动更新", module_runtime_incident: "出错" };
const short = (hash: unknown) => typeof hash === "string" ? hash.slice(0, 8) : "?";
type Row = { id: string; kind: string; subjectId: string | null; actorKey: string; details: unknown; createdAt: Date };
type Names = { modules: Map<string, string>; versions: Map<string, { module: string; hash: string }>; approvals: Map<string, { title: string; module: string | null }> };
/** `session` (v2-20): the conversation whose process this line is about (a reflection, or the build it started). */
export type Activity = { id: string; at: string; kind: string; module: string | null; text: string; session?: { id: string; source: "reflect" | "build" } };

function decisionText(details: Record<string, unknown>, title: string) {
  const source = SOURCES[String(details.source)] ?? "";
  return `你${details.decision === "approve" ? "批准" : "拒绝"}了${title}${source ? `（${source}）` : ""}`;
}
function approvalText(row: Row, details: Record<string, unknown>, names: Names) {
  const approval = row.subjectId ? names.approvals.get(row.subjectId) : undefined, title = `「${approval?.title ?? "已删除的审批"}」`;
  if (row.kind === "approval_created") return `生成审批${title}`;
  return decisionText(details, title);
}
/** Module rows name a module, or (checks) one of its versions. */
function subjectModule(row: Row, names: Names) {
  const version = row.subjectId ? names.versions.get(row.subjectId) : undefined;
  return { module: version?.module ?? (row.subjectId ? names.modules.get(row.subjectId) ?? null : null), hash: version?.hash };
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
function statusText(name: string, row: Row, details: Record<string, unknown>) {
  const paused = row.kind === "module_disabled", action = paused ? "暂停" : "恢复";
  let text = details.source === "chrona" ? `Chrona ${action}了 ${name}` : details.source === "cli" ? `你在命令行${action}了 ${name}` : `你${action}了 ${name}`;
  if (details.source === "remove") return `删除前暂停了 ${name}`;
  if (paused && details.source === "automatic") return `${name} 连续失败 3 次，已自动暂停（关联故障）`;
  if (paused && details.source === "chrona") text += `：${String(details.reason ?? "见诊断").slice(0, 120)}`;
  if (!paused && details.unrestoredLegacyPause) text += "；旧的自动暂停没有记录日程，相关日程仍保持暂停";
  return text;
}
function moduleText(row: Row, details: Record<string, unknown>, names: Names) {
  const subject = subjectModule(row, names), name = subject.module ?? "已删除的应用", hash = short(details.hash ?? subject.hash);
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
    module_disabled: statusText(name, row, details),
    module_enabled: statusText(name, row, details),
    module_settings_updated: `你修改了 ${name} 的设置：${Array.isArray(details.keys) ? details.keys.join("、") : ""}`,
  };
  return { text: texts[row.kind]!, module: subject.module };
}
function otherText(row: Row, details: Record<string, unknown>) {
  if (row.kind === "grant_created") return `你新增了授权：${String(details.action ?? "")}${details.mode ? ` · ${String(details.mode)}` : ""}`;
  if (row.kind === "grant_revoked") return "你撤销了一条授权";
  if (row.kind === "settings_updated") return `你修改了设置：${Object.keys(details).map(key => SETTINGS[key] ?? key).join("、")}`;
  if (row.kind === "secret_set" || row.kind === "secret_removed") return `你${row.kind === "secret_set" ? "设置" : "删除"}了凭据 ${String(details.name)}`;
  return "";
}
/** v2-19: why Chrona reflected, and what it started building; v2-20: the reflection app's lines, linked to their process. */
function reflectionText(row: Row, details: Record<string, unknown>) {
  const source = row.kind === "reflection_started" ? "reflect" as const : "build" as const;
  const line = (text: string) => ({ module: "reflection", text, ...(row.subjectId ? { session: { id: row.subjectId, source } } : {}) });
  if (row.kind === "reflection_started") {
    const signals = Array.isArray(details.signals) ? details.signals as { kind?: unknown; module?: unknown }[] : [];
    return line(`Chrona 反思了一次（${signals.slice(0, 3).map(signal => `${String(signal.module)} ${SIGNALS[String(signal.kind)] ?? ""}`).join("、")}${signals.length > 3 ? " 等" : ""}）`);
  }
  const modules = Array.isArray(details.modules) ? details.modules.map(String) : [];
  return line(`Chrona 开始构建「${String(details.title)}」（${modules.join("、")}）：${String(details.why)}`);
}
const otherLine = (row: Row, details: Record<string, unknown>) => row.kind.startsWith("reflection_") ? reflectionText(row, details) : { module: null, text: otherText(row, details) };
function describe(row: Row, names: Names): Activity | null {
  const details = (row.details && typeof row.details === "object" ? row.details : {}) as Record<string, unknown>;
  // Older automatic activation grants are not decisions made by the user.
  if (row.kind === "grant_created" && details.reason) return null;
  const base = { id: row.id, at: row.createdAt.toISOString(), kind: row.kind };
  if (row.kind.startsWith("approval_")) {
    const approval = row.subjectId ? names.approvals.get(row.subjectId) : undefined;
    return { ...base, module: approval?.module ?? null, text: approvalText(row, details, names) };
  }
  if (row.kind.startsWith("module_") || row.kind === "admin_rollback") return { ...base, ...moduleText(row, details, names) };
  return { ...base, ...otherLine(row, details) };
}
async function namesFor(db: StewardPorts["db"], workspaceId: string, rows: Row[]): Promise<Names> {
  const ids = [...new Set(rows.flatMap(row => row.subjectId ? [row.subjectId] : []))];
  const modules = await db.module.findMany({ where: { workspaceId }, select: { id: true, name: true } });
  const moduleNames = new Map(modules.map(module => [module.id, module.name]));
  const versions = await db.moduleVersion.findMany({ where: { id: { in: ids } }, select: { id: true, hash: true, moduleId: true } });
  const approvals = await db.approval.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, title: true, moduleId: true } });
  return {
    modules: moduleNames,
    versions: new Map(versions.map(version => [version.id, { module: moduleNames.get(version.moduleId) ?? "已删除的应用", hash: version.hash }])),
    approvals: new Map(approvals.map(approval => [approval.id, { title: approval.title, module: approval.moduleId ? moduleNames.get(approval.moduleId) ?? null : null }])),
  };
}
function aggregate(rows: Row[], names: Names) {
  const lines: Activity[] = [], incidents = new Map<string, { line: Activity; count: number }>();
  for (const row of rows) {
    const line = describe(row, names);
    if (!line) continue;
    const id = row.kind === "module_runtime_incident" ? (row.details as { id?: unknown } | null)?.id : null;
    if (typeof id !== "string") { lines.push(line); continue; }
    const key = `${row.subjectId}:${id}`, previous = incidents.get(key);
    if (previous) previous.count++;
    else { incidents.set(key, { line, count: 1 }); lines.push(line); }
  }
  for (const { line, count } of incidents.values()) if (count > 1) line.text += `（共 ${count} 次更新）`;
  return lines;
}
const startAt = (before?: string) => { const at = before ? new Date(before) : undefined; return at && !Number.isNaN(at.getTime()) ? at : undefined; };
/** Newest first; `before` pages back by time; `module` keeps one app's lines. */
export async function listActivity(ports: StewardPorts, workspaceId: string, { module, before, limit = 50 }: { module?: string; before?: string; limit?: number }) {
  const { db } = ports, take = Math.min(Math.max(limit, 1), 100), rows: Row[] = [];
  let cursor = startAt(before), items: Activity[] = [];
  // Filter after aggregating the entire bounded scan; counts include all scanned pages.
  for (let page = 0; page < 10 && items.length < take; page++) {
    const batch = await db.audit.findMany({ where: { workspaceId, kind: { in: [...KINDS] }, ...(cursor ? { createdAt: { lt: cursor } } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200 });
    rows.push(...batch);
    const names = await namesFor(db, workspaceId, rows);
    items = aggregate(rows, names).filter(item => !module || item.module === module).slice(0, take);
    if (batch.length < 200) break;
    cursor = batch.at(-1)!.createdAt;
  }
  return { items, before: items.length === take ? items.at(-1)!.at : null };
}
