"use client";

import type { GoalDataTableContent } from "@chrona/contracts";
import { parseTablePreview } from "@features/task-workspace/ui";

function escapeCsvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function hasBalancedCsvQuotes(content: string) {
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== '"') continue;
    if (quoted && content[index + 1] === '"') {
      index += 1;
      continue;
    }
    quoted = !quoted;
  }
  return !quoted;
}

export function goalDataTableFromCsv(content: string): GoalDataTableContent | null {
  const parsed = parseTablePreview("csv", content);
  if (!hasBalancedCsvQuotes(content) || parsed.parseError || parsed.inferredColumns.length === 0) return null;
  const columns = parsed.inferredColumns.map((label, index) => ({
    id: `column-${index}`,
    label,
    type: "text" as const,
  }));
  return {
    schemaVersion: 1,
    columns,
    rows: parsed.rows.map((row, rowIndex) => ({
      id: `csv-row-${rowIndex}`,
      values: Object.fromEntries(columns.map((column) => [column.id, String(row[column.label] ?? "")])),
    })),
  };
}

export function csvFromGoalDataTable(table: GoalDataTableContent) {
  return [
    table.columns.map((column) => escapeCsvCell(column.label)).join(","),
    ...table.rows.map((row) => table.columns.map((column) => escapeCsvCell(row.values[column.id])).join(",")),
  ].join("\n");
}

