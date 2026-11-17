import { PUBLIC_CALL_REASONS } from "@chrona/contracts/steward";
export type CallErrorCode = (typeof import("@chrona/contracts/steward").MODULE_CALL_ERRORS)[number];
export class CallError extends Error {
  constructor(public readonly code: CallErrorCode, message: string, public readonly reason?: (typeof PUBLIC_CALL_REASONS)[number]) { super(message); this.name = "CallError"; }
}

/** Internal provider/host reasons map onto the stable public error vocabulary. */
export function publicCallError(code: string): "invalid" | "forbidden" | "not_found" | "conflict" | "unavailable" | "cycle" | "failed" | "unknown" {
  if (["invalid", "forbidden", "not_found", "conflict", "unavailable", "cycle", "failed", "unknown"].includes(code)) return code as ReturnType<typeof publicCallError>;
  if (["unauthorized", "undeclared"].includes(code)) return "forbidden";
  if (["unconfigured", "reauthorize", "unsupported", "unsupported_version"].includes(code)) return "unavailable";
  if (["capacity", "budget_exceeded", "cursor_expired"].includes(code)) return "conflict";
  if (code === "too_large") return "invalid";
  if (code === "timeout") return "unknown";
  return "failed";
}

export const publicCallReason = (code: string) => PUBLIC_CALL_REASONS.find(reason => reason === (code === "unsupported_version" ? "unsupported" : code));
