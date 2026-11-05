import type { Spec } from "@json-render/core";
import { faultText } from "./text";

export type Approval = { id: string; title: string; detail?: string | null; preview?: string | null; createdAt: string; moduleId?: string | null };
export type Interaction = { id: string; expiresAt: string; status: string; question: { title: string; message?: string; method: string; options?: string[]; prefill?: string } };
type Run = { id: string; active: boolean; status: string; sessionTitle?: string; progress?: { phase: string }; interactions: Interaction[] };
type Today = {
  health?: { provider: { available: boolean; lastError?: string; name: string } };
  approvals: Approval[];
  problems: { moduleId: string; module: string; incidentStatus: string | null; contractFailures: number; nextAction: string }[];
  upcoming: { at: string; label?: string | null; mode: string }[];
  updates: { id: string; title: string; createdAt: string; body: string; status?: string; lastError?: string | null; feedback?: string | null }[];
  apps: { id: string; name: string; status: string; description?: string }[];
  sessions: { id: string; title?: string | null; key: string; source: string; lastActivityAt: string }[];
};

export const todayData = { today: { tool: "today" }, runs: { tool: "runs" } };
export function todaySpec(state: Record<string, unknown>): Spec {
  const elements: Spec["elements"] = {};
  let serial = 0;
  const node = (type: string, props: Record<string, unknown>, children: string[] = [], id = `n${serial++}`) => { elements[id] = { type, props, children }; return id; };
  const text = (value: string, muted = false) => node("Text", { text: value, variant: muted ? "muted" : null });
  const time = (value: string) => node("Time", { value });
  const link = (label: string, href: string) => node("Link", { label, href });
  const row = (...children: string[]) => node("Stack", { direction: "horizontal", gap: "sm", align: "center" }, children);
  const section = (title: string, children: string[]) => node("Card", { title }, [node("List", {}, children)]);
  const view = state.today as Today | undefined, runs = state.runs as Run[] | undefined;
  if (!view || !runs) return { root: node("Spinner", { label: "加载中……" }), elements };
  const sections: string[] = [];
  const questions = runs.flatMap(run => run.interactions.filter(item => item.status === "pending"));
  const active = runs.filter(run => run.active);
  if (view.health && !view.health.provider.available) sections.push(node("Alert", { title: `Provider 不可用：${view.health.provider.lastError ?? view.health.provider.name}`, type: "error" }));
  if (questions.length) sections.push(section(`Chrona 在问你（${questions.length}）`, questions.map(interaction => node("Question", { interaction }, [], `question-${interaction.id}`))));
  if (active.length) sections.push(section("正在处理", active.map(run => row(text(run.sessionTitle ?? "后台任务"), text(run.progress?.phase ?? run.status, true), node("SystemAction", { label: "停止", tool: "cancel", args: { id: run.id }, confirm: "停止这次处理？已经做完的部分会保留。" })))));
  sections.push(section(`待你决定（${view.approvals.length}）`, view.approvals.length ? view.approvals.map(approval => node("Approval", { approval }, [], `approval-${approval.id}`)) : [text("没有待处理的事项。", true)]));
  if (view.problems.length) sections.push(section(`需要处理的应用（${view.problems.length}）`, view.problems.map(problem => node("Stack", { gap: "sm" }, [row(link(problem.module, `/apps/${encodeURIComponent(problem.moduleId)}`), text(problem.incidentStatus ? faultText(problem.incidentStatus) : `输出不符合契约 ${problem.contractFailures} 次`)), text(problem.nextAction, true)]))));
  const failedNotifications = (items: Today["updates"]) => items.length ? [section(`未送达的通知（${items.length}）`, items.map(item => node("Stack", { gap: "sm" }, [row(text(item.title), time(item.createdAt)), text(item.lastError ? `${item.lastError.slice(0, 160)}${item.lastError.length > 160 ? "…" : ""}` : "通知未能送达。", true), link("检查通知设置", "/settings")])))] : [];
  sections.push(...failedNotifications(view.updates.filter(item => item.status === "failed")));
  sections.push(section("接下来", view.upcoming.length ? view.upcoming.map(item => row(time(item.at), text(item.label ?? item.mode))) : [text("七天内没有安排。", true)]));
  sections.push(section("最近通知", view.updates.length ? view.updates.map(item => node("Stack", { gap: "sm" }, [row(node("Heading", { text: item.title, level: "h3" }), time(item.createdAt)), node("CollapsedText", { content: item.body }), item.feedback ? text(item.feedback === "useful" ? "已标为有用" : "已标为没用", true) : row(...["useful", "not_useful"].map((feedback, i) => node("SystemAction", { label: i ? "没用" : "有用", tool: "feedback", args: { id: item.id, feedback } })))], `notification-${item.id}`)) : [text("暂无。", true)]));
  sections.push(section("应用", view.apps.map(app => row(link(app.name, `/apps/${encodeURIComponent(app.id)}`), text(app.status === "active" ? app.description ?? "" : "已暂停", true)))));
  sections.push(section("最近会话", view.sessions.map(session => row(link(session.title ?? session.key, `/sessions/${encodeURIComponent(session.id)}`), text(session.source, true), time(session.lastActivityAt)))));
  return { root: node("Stack", { gap: "lg" }, sections, "today"), elements };
}
