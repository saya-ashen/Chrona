export const EXECUTION_EVENT_CLASSIFICATIONS = {
  accepted: "accepted",
  ignored: "ignored",
  stale: "stale",
  diagnostic: "diagnostic",
} as const;

export type ExecutionEventClassification =
  (typeof EXECUTION_EVENT_CLASSIFICATIONS)[keyof typeof EXECUTION_EVENT_CLASSIFICATIONS];
