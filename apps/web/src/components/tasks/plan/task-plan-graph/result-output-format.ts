import type { NodeResultOutput } from "@chrona/contracts/ai";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonOutputText(value: unknown) {
  if (!isRecord(value)) return null;

  const outputText = value.outputText;
  return typeof outputText === "string" && outputText.trim() ? outputText : null;
}

export function stringifyResultOutput(output: NodeResultOutput) {
  if (output.kind === "markdown") return output.content;
  if (output.kind === "json") return jsonOutputText(output.value) ?? JSON.stringify(output.value, null, 2);
  if (output.kind === "file") return [output.title, output.path, output.description].filter(Boolean).join("\n");
  return "";
}
