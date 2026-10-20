import type { UiEvent } from "@chrona/contracts";
import type { StewardClient } from "./client";
import { markdownParts } from "./affair-file";
import { plainSummary } from "./affair-overview";

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

/** Short, few-column data should not expand into repeated labelled cards on phones. */
export function compactUiTable(columns: string[], rows: string[][]): boolean {
  const short = (text: string) => Array.from(plainSummary(text)).length <= 32;
  return columns.length > 0 && columns.length <= 3 && columns.every(short)
    && rows.every(row => row.length === columns.length && row.every(short));
}

/** Refresh server defaults without overwriting locally edited form branches.
 * Chrona actions never mutate page state. Nested objects/arrays are kept atomically
 * when edited, rather than guessing how to merge a draft with reordered content.
 */
export function pageStateUpdates(previous: Record<string, unknown>, local: Record<string, unknown>, incoming: Record<string, unknown>) {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return Object.fromEntries([...new Set([...Object.keys(local), ...Object.keys(incoming)])]
    .filter(key => same(local[key], previous[key]) && !same(local[key], incoming[key]))
    .map(key => [`/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, incoming[key]]));
}

/** Usage is best-effort and must never interfere with the user's action. */
export function recordUiEvent(client: StewardClient, affairId: string, input: UiEvent) {
  void Promise.resolve().then(() => client.uiEvent(affairId, input)).catch(() => {});
}
