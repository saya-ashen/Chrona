import {
  isStructuredResultAssetContent,
  type StructuredResultAssetContent,
} from "@chrona/contracts";
import type { UiDocument } from "@chrona/ui-protocol";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function markdownTable(columns: unknown, contentPreview: unknown) {
  const raw = stringValue(contentPreview);
  if (!raw) return "";
  const parsedColumns = Array.isArray(columns)
    ? columns.map((column) => typeof column === "string" ? column : stringValue(record(column)?.label) || stringValue(record(column)?.key)).filter(Boolean)
    : [];
  if (!parsedColumns.length) return `\`\`\`\n${raw}\n\`\`\``;
  return `${parsedColumns.join(" | ")}\n${parsedColumns.map(() => "---").join(" | ")}\n\n\`\`\`\n${raw}\n\`\`\``;
}

function elementMarkdown(element: UiDocument["elements"][string]) {
  const props = record(element.props) ?? {};
  const title = stringValue(props.title) || stringValue(props.collapseTitle);
  switch (element.type) {
    case "ResultSummary":
      return ["## Result summary", stringValue(props.text)].filter(Boolean).join("\n\n");
    case "Heading":
      return `${stringValue(props.level) === "h1" ? "#" : stringValue(props.level) === "h2" ? "##" : "###"} ${stringValue(props.text)}`.trim();
    case "Text":
      return stringValue(props.text) || stringValue(props.content);
    case "RichMarkdown":
      return [title ? `## ${title}` : "", stringValue(props.content)].filter(Boolean).join("\n\n");
    case "Alert":
      return [title ? `> **${title}**` : "> Note", stringValue(props.description) ? `> ${stringValue(props.description)}` : ""].filter(Boolean).join("\n");
    case "JsonView":
      return [title ? `## ${title}` : "", "```json", JSON.stringify(props.value, null, 2), "```"].filter(Boolean).join("\n");
    case "Table":
      return [title ? `## ${title}` : "", stringValue(props.description), markdownTable(props.columns, props.contentPreview)].filter(Boolean).join("\n\n");
    case "FileRef":
    case "FileView": {
      const display = title || stringValue(props.displayPath) || stringValue(props.path) || "File";
      return `- **${display}**${stringValue(props.description) ? ` — ${stringValue(props.description)}` : ""}`;
    }
    default:
      return title ? `## ${title}` : "";
  }
}

function walkSpec(spec: UiDocument, key: string, seen: Set<string>, output: string[]) {
  if (seen.has(key)) return;
  seen.add(key);
  const element = spec.elements[key];
  if (!element) return;
  const section = elementMarkdown(element);
  if (section) output.push(section);
  for (const child of element.children ?? []) walkSpec(spec, child, seen, output);
}

export function structuredResultToMarkdown(content: StructuredResultAssetContent) {
  const output: string[] = [];
  walkSpec(content.spec, content.spec.root, new Set<string>(), output);
  if (!output.some((item) => item.includes(content.summary)) && content.summary.trim()) {
    output.unshift(`## Result summary\n\n${content.summary.trim()}`);
  }
  if (content.artifactRefs.length) {
    output.push([
      "## Files",
      ...content.artifactRefs.map((artifact) => `- **${artifact.title}** (${artifact.ref})`),
    ].join("\n"));
  }
  return `${output.join("\n\n").trim()}\n`;
}

export function goalAssetContentToMarkdown(kind: string, content: unknown) {
  if (kind === "structured_result") {
    if (!isStructuredResultAssetContent(content)) throw new Error("Invalid structured result asset content");
    return structuredResultToMarkdown(content);
  }
  if (typeof content === "string") return content;
  return `\`\`\`json\n${JSON.stringify(content, null, 2)}\n\`\`\`\n`;
}

