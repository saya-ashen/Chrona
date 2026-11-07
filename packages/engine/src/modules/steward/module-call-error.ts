export type CallErrorCode = (typeof import("@chrona/contracts/steward").MODULE_CALL_ERRORS)[number];
export class CallError extends Error {
  constructor(public readonly code: CallErrorCode, message: string) { super(message); this.name = "CallError"; }
}
