import { formatKeyValue, getObject } from "./index.js";

export function formatRunResult(value: unknown): string {
  const result = getObject(value);
  return formatKeyValue("Result", Object.entries(result));
}
