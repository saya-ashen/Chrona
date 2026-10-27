import type { Action } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { createApprovals } from "./approvals";
import { notifyUser } from "./notify-user";

/**
 * v2-17 §5: once a week, from the last seven days of decisions, suggest where approvals can be fewer or should be read
 * more carefully. Suggestions only inform or open an approval; nothing loosens without the user confirming on the page.
 */
export type Decision = { id: string; action: string; level: string; status: string; title: string; moduleId: string | null; moduleName: string | null; kind: string | null; createdAt: Date; resolvedAt: Date | null };
export type Suggestion =
  | { kind: "stop_asking"; action: Action; approved: number; text: string }
  | { kind: "read_red"; count: number; medianSeconds: number; text: string }
  | { kind: "denied_module"; moduleId: string; denied: number; text: string }
  | { kind: "waiting"; ids: string[]; text: string };
const WEEK_MS = 7 * 24 * 3600_000;
const LABELS: Partial<Record<string, string>> = { schedule: "设置日程", modify_external: "修改外部系统", read_source: "读取来源", connect_source: "接入来源", notify_user: "通知你" };
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)]! : 0; };

export function suggestHabits(decisions: Decision[], now: Date): Suggestion[] {
  const recent = decisions.filter(row => now.getTime() - row.createdAt.getTime() <= WEEK_MS);
  const suggestions: Suggestion[] = [];
  // Chrona's own (Provider) requests of one yellow kind, always approved: offer to stop asking.
  const provider = recent.filter(row => !row.moduleId && row.level === "yellow" && row.kind !== "module_request" && row.kind !== "grant_suggestion" && row.status !== "open");
  for (const action of new Set(provider.map(row => row.action))) {
    const rows = provider.filter(row => row.action === action);
    if (rows.length >= 5 && rows.every(row => row.status === "approved")) {
      suggestions.push({ kind: "stop_asking", action: action as Action, approved: rows.length, text: `「${LABELS[action] ?? action}」这周你批准了 ${rows.length} 次、没有拒绝过，以后可以不再问你。` });
    }
  }
  const red = recent.filter(row => row.level === "red" && row.status === "approved" && row.resolvedAt).map(row => (row.resolvedAt!.getTime() - row.createdAt.getTime()) / 1000);
  if (red.length >= 3 && median(red) < 10) suggestions.push({ kind: "read_red", count: red.length, medianSeconds: Math.round(median(red)), text: `这周 ${red.length} 张高风险审批，你一般 ${Math.round(median(red))} 秒内就批准了；高风险的请先展开详情看一眼。` });
  const denied = new Map<string, Decision[]>();
  for (const row of recent.filter(row => row.action === "activate_module" && row.moduleId && row.status === "denied")) denied.set(row.moduleId!, [...denied.get(row.moduleId!) ?? [], row]);
  for (const [moduleId, rows] of denied) if (rows.length >= 3) suggestions.push({ kind: "denied_module", moduleId, denied: rows.length, text: `${rows[0]!.moduleName ?? "一个应用"} 的更新这周被你拒绝了 ${rows.length} 次，需要的话可以让 Chrona 停下它的构建或换个做法。` });
  const waiting = decisions.filter(row => row.status === "open" && now.getTime() - row.createdAt.getTime() > 3 * 24 * 3600_000);
  if (waiting.length) suggestions.push({ kind: "waiting", ids: waiting.map(row => row.id), text: `有 ${waiting.length} 张审批已经等了三天以上：${waiting.slice(0, 3).map(row => row.title).join("、")}${waiting.length > 3 ? " 等" : ""}。` });
  return suggestions;
}

/** Due once every seven days (the last run is an audit row); sends one digest notice and opens one approval per stop-asking suggestion. */
export async function weeklyHabits(ports: StewardPorts, workspaceId: string) {
  const { db } = ports, now = ports.now();
  const last = await db.audit.findFirst({ where: { workspaceId, kind: "approval_habits" }, orderBy: { createdAt: "desc" } });
  if (last && now.getTime() - last.createdAt.getTime() < WEEK_MS) return [];
  const rows = await db.approval.findMany({ where: { workspaceId, createdAt: { gte: new Date(now.getTime() - 4 * WEEK_MS) } }, include: { module: { select: { name: true } } }, take: 2000 });
  const decisions = rows.map(row => ({ ...row, moduleName: row.module?.name ?? null, kind: (row.payload as { kind?: string } | null)?.kind ?? null }));
  const suggestions = suggestHabits(decisions, now);
  await db.audit.create({ data: { workspaceId, actorKey: "chrona", kind: "approval_habits", createdAt: now, details: { suggestions: suggestions.map(item => item.kind) } } });
  if (!suggestions.length) return suggestions;
  const approvals = createApprovals({ db, workspaceId, now: ports.now }, undefined, ports);
  for (const item of suggestions) {
    if (item.kind !== "stop_asking") continue;
    await approvals.create({ action: "change_policy", title: `以后不再询问：${LABELS[item.action] ?? item.action}`, detail: item.text,
      preview: `批准后，Chrona 做「${LABELS[item.action] ?? item.action}」时不再先问你（可在设置「授权规则」里撤销）。`, payload: { kind: "grant_suggestion", action: item.action } });
  }
  await notifyUser(db, ports, workspaceId, { level: "digest", title: "这周的审批习惯", body: suggestions.map(item => `• ${item.text}`).join("\n"), key: `approval-habits:${now.toISOString().slice(0, 10)}` });
  return suggestions;
}
