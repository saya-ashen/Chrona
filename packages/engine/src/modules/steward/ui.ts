import { checkUiSpec, safeUiPath } from "@chrona/ui-catalog";
import { uiEventSchema, type FileNode } from "@chrona/contracts/steward";
import { requireAffair, type RecordContext } from "./affairs";
import type { WorkspaceFs } from "./workspace-fs";
import type { ChatInput } from "./chat";
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";

type Files = ReturnType<WorkspaceFs["forAffair"]>;
export async function uiEntry(files: Files, tree: FileNode[]): Promise<string> {
  const pointer = await optionalText(files, ".chrona/entry");
  const path = pointer?.trim();
  if (safeUiPath(path) && path.endsWith(".ui.json") && tree.some(file => file.kind === "file" && file.path === path)) return path;
  return tree.find(file => file.kind === "file" && !file.path.includes("/") && file.path.endsWith(".ui.json"))?.path ?? "README.md";
}
async function optionalText(files: Files, path: string): Promise<string | null> {
  try { return (await files.read(path)).content; }
  catch (error) {
    if (["ENOENT", "invalid", "forbidden"].includes((error as { code: string }).code)) return null;
    throw error;
  }
}
export async function readUiCard(files: Files): Promise<Record<string, unknown> | null> {
  return readSpec(files, ".chrona/card.ui.json");
}
async function readSpec(files: Files, path: string): Promise<Record<string, unknown> | null> {
  const text = await optionalText(files, path);
  if (!text) return null;
  try { const spec: unknown = JSON.parse(text); return checkUiSpec(spec).ok ? spec as Record<string, unknown> : null; }
  catch { return null; }
}
export function uiSummary(spec: object): string {
  const elements = (spec as { elements: Record<string, { type: string; props: Record<string, unknown> }> }).elements;
  return Object.values(elements).map(element => {
    const detail = ["Heading", "Text"].includes(element.type) ? element.props.text : element.type === "TaskList" ? element.props.path : "";
    return `${element.type}${typeof detail === "string" ? ": " + detail : ""}`;
  }).join("\n").slice(0, 1500);
}
function usageCounts(rows: { details: unknown }[]) {
  const counts = new Map<string, number>(), toggled = new Set<string>();
  for (const row of rows) {
    const event = uiEventSchema.safeParse(row.details);
    if (!event.success) continue;
    const { kind, path, name } = event.data;
    if (kind === "toggle") toggled.add(path);
    if (kind === "open" || kind === "action") {
      const key = kind === "open" ? `Page opened: ${path}` : `Action used: ${name ?? "unnamed"}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return { counts, toggled };
}
async function taskPaths(files: Files) {
  const tasks = new Set<string>();
  for (const file of await files.tree()) {
    if (file.kind !== "file" || !file.path.endsWith(".ui.json")) continue;
    const spec = await readSpec(files, file.path);
    if (!spec) continue;
    for (const element of Object.values(spec.elements as Record<string, { type: string; props: { path?: string } }>)) {
      if (element.type === "TaskList" && element.props.path) tasks.add(element.props.path);
    }
  }
  return tasks;
}
export async function uiUsage(ctx: RecordContext, id: string, files: Files): Promise<string[]> {
  const rows = await ctx.db.audit.findMany({ where: { workspaceId: ctx.workspaceId, subjectId: id, kind: "ui_event", createdAt: { gte: new Date(ctx.now().getTime() - 14 * 86400000) } } });
  const { counts, toggled } = usageCounts(rows), tasks = await taskPaths(files);
  return [...Array.from(counts, ([key, count]) => `${key}: ${count}`), ...Array.from(tasks).filter(path => !toggled.has(path)).map(path => `TaskList never toggled: ${path}`)].slice(0, 10);
}
export function createUiEvents(ctx: RecordContext, chat: (input: ChatInput) => Promise<unknown>) {
  return async (id: string, raw: unknown) => {
    const input = parseInput(uiEventSchema, raw);
    const affair = await requireAffair(ctx.db, ctx.workspaceId, id);
    if (input.kind === "feedback" && (!input.text?.trim() || affair.status !== "active")) throw new StewardError("invalid", "Feedback requires text and an active affair");
    await audit(ctx.db, { workspaceId: ctx.workspaceId, actor: "user", kind: "ui_event", subjectId: id, details: { path: input.path, kind: input.kind, ...(input.name === undefined ? {} : { name: input.name }) } });
    if (input.kind === "feedback") await chat({ workspaceId: ctx.workspaceId, channel: "in_app", affairId: id, text: `对页面「${input.path}」的意见：${input.text}` });
    return { ok: true };
  };
}
