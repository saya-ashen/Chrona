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
  OpenClawStructuredRunResult,
} from "../protocol/types";
import type { BridgeFeature } from "../transport/bridge-types";
import type { RuntimeInput } from "@chrona/runtime-core";

export type OpenClawWaitForRunInput = {
  runtimeRunRef: string;
  runtimeSessionKey?: string;
  timeoutMs?: number;
};

export interface OpenClawRuntimeClient {
  connect(): Promise<OpenClawHello>;
  close(code?: number, reason?: string): void;
  createRun(input: {
    prompt: string;
    runtimeInput: RuntimeInput;
    runtimeSessionKey?: string;
  }): Promise<{
    runtimeRunRef?: string;
    runtimeSessionRef?: string;
    runtimeSessionKey?: string;
    runStarted: boolean;
  }>;
  createStructuredRun<T = unknown>(input: {
    feature: BridgeFeature;
    prompt: string;
    runtimeSessionKey?: string;
    instructions?: string;
    timeoutSeconds?: number;
  }): Promise<OpenClawStructuredRunResult<T>>;
  getStructuredResult<T = unknown>(
    runtimeSessionKey: string,
  ): Promise<OpenClawStructuredRunResult<T> | null>;
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


