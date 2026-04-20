import type {
  OpenClawApprovalDecision,
  OpenClawApprovalRequest,
  OpenClawApprovalRequestResult,
  OpenClawApprovalResolution,
  OpenClawChatHistory,
  OpenClawHello,
  OpenClawPendingApproval,
  OpenClawRunSnapshot,
  OpenClawSendInput,
  OpenClawSendInputResult,
} from "@/modules/openclaw/types";

export type OpenClawWaitForRunInput = {
  runtimeRunRef: string;
  runtimeSessionKey?: string;
  timeoutMs?: number;
};

export interface OpenClawRuntimeClient {
  connect(): Promise<OpenClawHello>;
  close(code?: number, reason?: string): void;
  createRun(input: { prompt: string; runtimeSessionKey?: string }): Promise<{
    runtimeRunRef?: string;
    runtimeSessionRef?: string;
    runtimeSessionKey?: string;
    runStarted: boolean;
  }>;
  waitForRun(
    input: OpenClawWaitForRunInput | string,
    timeoutMs?: number,
  ): Promise<OpenClawRunSnapshot>;
  readOutputs(runtimeSessionKey: string): Promise<OpenClawChatHistory>;
  listApprovals(): Promise<OpenClawPendingApproval[]>;
  sendInput(input: OpenClawSendInput): Promise<OpenClawSendInputResult>;
  waitForApprovalDecision(approvalId: string): Promise<OpenClawApprovalDecision | null>;
  requestApproval(input: OpenClawApprovalRequest): Promise<OpenClawApprovalRequestResult>;
  resolveApproval(input: OpenClawApprovalResolution): Promise<{
    accepted: boolean;
  }>;
}
