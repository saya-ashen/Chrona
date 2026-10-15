import { toolSpecSchema, validatePanelEntry, type ToolSpec } from "@chrona/domain";
export { toolSpecSchema, validatePanelEntry };
export type { ToolSpec };
export function initialPanelValues(spec: ToolSpec, now = new Date()): Record<string, string> {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return Object.fromEntries(spec.fields.map(f => [f.key, f.type === "date" ? date : ""]));
}
export function trendPoints(rows: { values: Record<string, unknown> }[], x: string, y: string) {
  const data = rows.flatMap(row => {
    const date = row.values[x], value = row.values[y];
    return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && typeof value === "number" && Number.isFinite(value) ? [{ date, time: Date.parse(date), value }] : [];
  }).sort((a, b) => a.time - b.time);
  if (!data.length) return null;
  const min = Math.min(...data.map(d => d.value)), max = Math.max(...data.map(d => d.value));
  const padding = min === max ? 1 : (max - min) * 0.05;
  const lower = min - padding, upper = max + padding;
  const first = data[0]!, last = data.at(-1)!;
  return { min, max, lower, upper, first: first.date, last: last.date, points: data.map(d => ({ ...d, x: first.time === last.time ? 300 : 60 + (d.time - first.time) / (last.time - first.time) * 480, y: 200 - (d.value - lower) / (upper - lower) * 160 })) };
}
