import type { UiEvent } from "@chrona/contracts";
import type { StewardClient } from "./client";
import { markdownParts } from "./affair-file";

export type PageTask = { line: number; text: string; checked: boolean };
/** `- [ ]` items of a Markdown page, optionally only those under one heading (until the next heading of the same or higher level). */
export function pageTasks(content: string, section: string | null): PageTask[] {
  if (!section) return markdownParts(content).flatMap(part => part.kind === "task" ? [{ line: part.line, text: part.text, checked: part.checked }] : []);
  const lines = content.split("\n");
  const start = lines.findIndex(line => /^#{1,6}\s/.test(line) && line.replace(/^#{1,6}\s+/, "").trim() === section.trim());
  if (start < 0) return [];
  const level = /^#+/.exec(lines[start]!)![0].length;
  const end = lines.findIndex((line, index) => index > start && new RegExp(`^#{1,${level}}\\s`).test(line));
  const inside = (line: number) => line > start + 1 && (end < 0 || line <= end);
  return pageTasks(content, null).filter(task => inside(task.line));
}
/** Explicit navigation wins over the Provider-selected entry. */
export function selectedPage(entry: string | undefined, path: string | null) {
  return path || entry || "README.md";
}

/** Usage is best-effort and must never interfere with the user's action. */
export function recordUiEvent(client: StewardClient, affairId: string, input: UiEvent) {
  void Promise.resolve().then(() => client.uiEvent(affairId, input)).catch(() => {});
}
