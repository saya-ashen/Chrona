import type { StewardPorts } from "./ports";

/**
 * v2-18: what Chrona did that the user cares about, one sentence each, from the kernel's audit trail. Only the kernel
 * reads audits and words them, so a module (the page included) can show the record but never write or reword it.
 */
const KINDS = ["approval_created", "approval_review", "approval_resolved", "module_build_started", "module_submission", "module_build_settled", "module_build_rejection",
  "module_activate", "module_auto_activated", "module_rollback", "admin_rollback", "module_migration_started", "module_runtime_incident",
  "grant_created", "grant_revoked", "settings_updated", "secret_set", "secret_removed", "approval_habits", "reflection_started", "reflection_suggested"] as const;
const LEVELS: Record<string, string> = { green: "低风险", yellow: "注意", red: "高风险" };
const SOURCES: Record<string, string> = { web: "网页", qq: "QQ", mcp: "MCP", cli: "命令行", rescue: "救援控制台", entry: "其他应用" };
const SETTINGS: Record<string, string> = { notifications: "通知", moduleModel: "模块模型", builds: "构建", reflection: "主动反思" };
const SIGNALS: Record<string, string> = { module_activate: "上线", module_auto_activated: "自动更新", module_runtime_incident: "出错" };
const short = (hash: unknown) => typeof hash === "string" ? hash.slice(0, 8) : "?";
type Row = { id: string; kind: string; subjectId: string | null; actorKey: string; details: unknown; createdAt: Date };
type Names = { modules: Map<string, string>; versions: Map<string, { module: string; hash: string }>; approvals: Map<string, { title: string; level: string; module: string | null }> };
/** `session` (v2-20): the conversation whose process this line is about (a reflection, or the build it started). */
export type Activity = { id: string; at: string; kind: string; module: string | null; text: string; session?: { id: string; source: "reflect" | "build" } };

const REVIEWS: Record<string, string> = { passed: "通过", escalated: "提高了风险等级" };
function decisionText(details: Record<string, unknown>, title: string) {
  const source = SOURCES[String(details.source)] ?? "";
  return `你${details.decision === "approve" ? "批准" : "拒绝"}了${title}${source ? `（${source}）` : ""}`;
}
function approvalText(row: Row, details: Record<string, unknown>, names: Names) {
  const approval = row.subjectId ? names.approvals.get(row.subjectId) : undefined, title = `「${approval?.title ?? "已删除的审批"}」`;
  if (row.kind === "approval_created") return `生成审批${title}${approval ? `（${LEVELS[approval.level] ?? approval.level}）` : ""}`;
  if (row.kind === "approval_review") return `AI 复核${title}：${REVIEWS[String(details.outcome)] ?? "未能完成，改为问你"}`;
  return decisionText(details, title);
}
/** Module rows name a module, or (checks) one of its versions. */
function subjectModule(row: Row, names: Names) {
  const version = row.subjectId ? names.versions.get(row.subjectId) : undefined;
  return { module: version?.module ?? (row.subjectId ? names.modules.get(row.subjectId) ?? null : null), hash: version?.hash };
}
function moduleText(row: Row, details: Record<string, unknown>, names: Names) {
  const subject = subjectModule(row, names), name = subject.module ?? "已删除的应用", hash = short(details.hash ?? subject.hash);
  const reason = (details.evidence as { reason?: unknown } | undefined)?.reason;
  const texts: Record<string, string> = {
    module_build_started: `开始检查 ${name} 的候选版本 ${hash}`,
    module_submission: `${name} 提交了候选版本 ${hash}`,
    module_build_settled: `${name} 的候选版本 ${hash} ${details.succeeded ? "检查完成" : "检查失败"}`,
    module_build_rejection: `${name} 的候选版本 ${hash} 未通过检查`,
    module_activate: `${name} 已切换到版本 ${hash}`,
    module_auto_activated: `${name} 已自动更新到版本 ${hash}（低风险，复核通过）`,
    module_rollback: `${name} 已回滚到版本 ${hash}`,
    admin_rollback: `你在命令行把 ${name} 回滚到版本 ${hash}`,
    module_migration_started: `${name} 开始迁移数据（${String(details.from)} → ${String(details.to)}）`,
    module_runtime_incident: `${name} 运行出错：${typeof reason === "string" ? reason.slice(0, 120) : "见诊断"}`,
  };
  return { text: texts[row.kind]!, module: subject.module };
}
function otherText(row: Row, details: Record<string, unknown>) {
  if (row.kind === "grant_created") return `你新增了授权：${String(details.action ?? "")}${details.mode ? ` · ${String(details.mode)}` : ""}`;
  if (row.kind === "grant_revoked") return "你撤销了一条授权";
  if (row.kind === "settings_updated") return `你修改了设置：${Object.keys(details).map(key => SETTINGS[key] ?? key).join("、")}`;
  if (row.kind === "secret_set" || row.kind === "secret_removed") return `你${row.kind === "secret_set" ? "设置" : "删除"}了凭据 ${String(details.name)}`;
  return `生成本周审批习惯建议（${Array.isArray(details.suggestions) ? details.suggestions.length : 0} 条）`;
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
  // Chrona's one-time grant for a green update is part of the auto-update line, not a decision of the user's.
  if (row.kind === "grant_created" && details.reason) return null;
  const base = { id: row.id, at: row.createdAt.toISOString(), kind: row.kind };
  if (row.kind.startsWith("approval_") && row.kind !== "approval_habits") {
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
  const approvals = await db.approval.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, title: true, level: true, moduleId: true } });
  return {
    modules: moduleNames,
    versions: new Map(versions.map(version => [version.id, { module: moduleNames.get(version.moduleId) ?? "已删除的应用", hash: version.hash }])),
    approvals: new Map(approvals.map(approval => [approval.id, { title: approval.title, level: approval.level, module: approval.moduleId ? moduleNames.get(approval.moduleId) ?? null : null }])),
  };
}
const startAt = (before?: string) => { const at = before ? new Date(before) : undefined; return at && !Number.isNaN(at.getTime()) ? at : undefined; };
/** Newest first; `before` pages back by time; `module` keeps one app's lines. */
export async function listActivity(ports: StewardPorts, workspaceId: string, { module, before, limit = 50 }: { module?: string; before?: string; limit?: number }) {
  const { db } = ports, take = Math.min(Math.max(limit, 1), 100), out: Activity[] = [];
  let cursor = startAt(before);
  // A module filter is applied after wording, so read in pages until enough lines or no more rows.
  for (let page = 0; page < 10 && out.length < take; page++) {
    const rows = await db.audit.findMany({ where: { workspaceId, kind: { in: [...KINDS] }, ...(cursor ? { createdAt: { lt: cursor } } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
    const names = await namesFor(db, workspaceId, rows);
    const items = rows.map(row => describe(row, names)).filter((item): item is Activity => !!item && (!module || item.module === module));
    out.push(...items.slice(0, take - out.length));
    if (rows.length < 200) break;
    cursor = rows.at(-1)!.createdAt;
  }
  return { items: out, before: out.length === take ? out.at(-1)!.at : null };
}
