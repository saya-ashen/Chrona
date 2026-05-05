type StructuredResultReliability =
  | "business_tool"
  | "assistant_text";

interface StructuredValidationIssue {
  path: string;
  message: string;
}

export interface StructuredAgentResult<T = unknown> {
  ok: boolean;
  parsed: T | null;
  source?: StructuredResultReliability;
  feature?: string | null;
  toolName?: string | null;
  rawOutput?: string | null;
  error?: string | null;
  validationIssues?: StructuredValidationIssue[];
  sessionId?: string;
  runId?: string;
  bridgeToolCalls?: Array<{
    tool: string;
    callId?: string;
    input: Record<string, unknown>;
    result?: string;
    status?: "pending" | "completed" | "error";
  }>;
}
