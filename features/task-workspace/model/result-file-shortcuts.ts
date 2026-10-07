import type { UiDocument } from "@chrona/ui-protocol";

/** Only files already exposed by the current hydrated result, never task-wide
 * artifacts (which may belong to a previous execution). No URL fabrication. */
export function resultFileShortcuts(spec: UiDocument) {
  const seen = new Set<string>();
  const files: Array<{ key: string; title: string; href: string; primary: boolean }> = [];
  function visit(key: string) {
    if (seen.has(key)) return;
    seen.add(key);
    const element = spec.elements[key];
    if (!element) return;
    const props = element.props;
    if (element.type === "ResultDeliverable" && typeof props.downloadHref === "string" && typeof props.title === "string") {
      files.push({ key, title: props.title, href: props.downloadHref, primary: props.role === "primary" });
    }
    for (const child of element.children ?? []) visit(child);
  }
  visit(spec.root);
  return files.sort((a, b) => Number(b.primary) - Number(a.primary))
    .filter((file, index, all) => all.findIndex(other => other.href === file.href) === index).slice(0, 3);
}
