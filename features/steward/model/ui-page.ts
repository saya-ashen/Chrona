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
/** The page an affair opens on: a root `*.ui.json` the Provider composed, else README. */
export function entryPath(files: { path: string; kind: string }[]) {
  return files.find(file => file.kind === "file" && !file.path.includes("/") && file.path.endsWith(".ui.json"))?.path ?? "README.md";
}
