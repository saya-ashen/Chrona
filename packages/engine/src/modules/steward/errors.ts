export type StewardErrorCode = "not_found" | "conflict" | "invalid" | "forbidden";
export class StewardError extends Error {
  constructor(public readonly code: StewardErrorCode, message: string) { super(message); this.name = "StewardError"; }
}
export function parseInput<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new StewardError("invalid", "Invalid input");
  return parsed.data;
}
