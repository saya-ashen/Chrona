export type StewardErrorCode = "not_found" | "conflict" | "invalid" | "forbidden";
export class StewardError extends Error {
  constructor(public readonly code: StewardErrorCode, message: string) { super(message); this.name = "StewardError"; }
}
export function parseInput<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error?: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new StewardError("invalid", `Invalid input: ${parsed.error?.issues.map(issue => `${issue.path.map(String).join(".") || "input"}: ${issue.message}`).join("; ") ?? "check the tool schema"}`);
  return parsed.data;
}
