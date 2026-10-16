import { uiEventSchema } from "@chrona/contracts/steward";
import { requireAffair, type RecordContext } from "./affairs";
import type { ChatInput } from "./chat";
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";

import { readSpec, type Files } from "./ui-files";
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
