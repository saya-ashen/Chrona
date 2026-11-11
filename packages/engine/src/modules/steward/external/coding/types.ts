import type { ExecutionStart, ExecutionView, ExecutionResult } from "./contract.js";
export type CodingContext = {
  dir: string;
  content: string;
  call<T>(target: string, args: Record<string, unknown>, options?: { key?: string }): Promise<T>;
  callStatus?(selector: { target: string; key: string }): Promise<{ status: string; output?: unknown; error?: string | { code: string; message: string } }>;
};
export type CodingWork = {
  start: ExecutionStart;
  ref?: Pick<ExecutionView, "workId" | "sessionId" | "runId" | "attemptId">;
  results: ExecutionResult[];
  acceptances: { commandKey: string; resultId: string }[];
};
