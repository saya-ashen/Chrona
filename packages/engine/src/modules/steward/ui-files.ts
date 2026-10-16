import { checkUiSpec, safeUiPath } from "@chrona/ui-catalog";
import type { FileNode } from "@chrona/contracts/steward";
import type { WorkspaceFs } from "./workspace-fs";

/** Read-only helpers over an affair's composed pages (no engine services, so affairs/today can use them). */
export type Files = ReturnType<WorkspaceFs["forAffair"]>;
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
export async function readSpec(files: Files, path: string): Promise<Record<string, unknown> | null> {
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
