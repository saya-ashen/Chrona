import type { OpenClawRuntimeClient } from "./runtime-client";
import { OpenClawEmbeddedClient } from "../transport/embedded-client";
import { createMockOpenClawAdapter } from "./mock-adapter";
import {
  getOpenClawTaskConfigSpec,
  OPENCLAW_RUNTIME_ADAPTER_KEY,
  OPENCLAW_RUNTIME_INPUT_VERSION,
  validateOpenClawTaskConfig,
} from "../config/config";
import type { RuntimeInput } from "@chrona/runtime-core";
import type {
  OpenClawApprovalDecision,
  OpenClawChatHistory,
  OpenClawExecuteTaskInput,
  OpenClawExecuteTaskResult,
  OpenClawPendingApproval,
  OpenClawRunSnapshot,
  OpenClawSendInputResult,
  OpenClawSessionStatus,
} from "../protocol/types";
import { OpenClawOrchestrator } from "./orchestrator";

export {
  getOpenClawTaskConfigSpec,
  OPENCLAW_RUNTIME_ADAPTER_KEY,
  OPENCLAW_RUNTIME_INPUT_VERSION,
  validateOpenClawTaskConfig,
};

export type OpenClawAdapter = {
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
  sendOperatorMessage(input: {
    runtimeSessionKey: string;
    message: string;
  }): Promise<OpenClawSendInputResult>;
  getRunSnapshot(input: {
    runtimeRunRef: string;
    runtimeSessionKey?: string;
    timeoutMs?: number;
  }): Promise<OpenClawRunSnapshot>;
  readHistory(input: { runtimeSessionKey: string }): Promise<OpenClawChatHistory>;
  listApprovals(input: { runtimeSessionKey: string }): Promise<OpenClawPendingApproval[]>;
  waitForApprovalDecision(approvalId: string): Promise<OpenClawApprovalDecision | null>;
  resumeRun(input: {
    runtimeSessionKey: string;
    approvalId?: string;
    decision?: "approve" | "reject";
    inputText?: string;
  }): Promise<OpenClawSendInputResult | { accepted: boolean }>;

  /**
   * High-level method that orchestrates the full task lifecycle:
   * create/reuse session -> start run -> poll -> handle approvals -> return result.
   * Retries on transient failures with exponential backoff.
   */
  executeTask(input: OpenClawExecuteTaskInput): Promise<OpenClawExecuteTaskResult>;

  /**
   * Returns current session state including active run status and pending approvals.
   * Useful for CLI status checks and dashboard displays.
   */
  getSessionStatus(runtimeSessionKey: string): Promise<OpenClawSessionStatus>;
};

export async function createRuntimeAdapter(): Promise<OpenClawAdapter> {
  if (process.env.OPENCLAW_MODE === "mock") {
    return createMockOpenClawAdapter();
  }

  const client = new OpenClawEmbeddedClient({
    timeoutSeconds: process.env.OPENCLAW_TIMEOUT ? Number(process.env.OPENCLAW_TIMEOUT) : undefined,
  });
  return createLiveOpenClawAdapter(client);
}

export function createLiveOpenClawAdapter(client: OpenClawRuntimeClient): OpenClawAdapter {
  const baseAdapter = {
    async createRun(input: {
      prompt: string;
      runtimeInput: RuntimeInput;
      runtimeSessionKey?: string;
    }) {
      return client.createRun({
        prompt: input.prompt,
        runtimeInput: input.runtimeInput,
        runtimeSessionKey: input.runtimeSessionKey,
      });
    },
    async sendOperatorMessage(input: {
      runtimeSessionKey: string;
      message: string;
    }) {
      return client.sendInput({
        runtimeSessionKey: input.runtimeSessionKey,
        message: input.message,
      });
    },
    async getRunSnapshot(input: {
      runtimeRunRef: string;
      runtimeSessionKey?: string;
      timeoutMs?: number;
    }) {
      return client.waitForRun({
        runtimeRunRef: input.runtimeRunRef,
        runtimeSessionKey: input.runtimeSessionKey,
        timeoutMs: input.timeoutMs ?? 1000,
      });
    },
    async readHistory(input: { runtimeSessionKey: string }) {
      return client.readOutputs(input.runtimeSessionKey);
    },
    async listApprovals(input: { runtimeSessionKey: string }) {
      return (await client.listApprovals()).filter(
        (approval) => approval.sessionKey === input.runtimeSessionKey,
      );
    },
    async waitForApprovalDecision(approvalId: string) {
      try {
        return await client.waitForApprovalDecision(approvalId);
      } catch {
        return null;
      }
    },
    async resumeRun(input: {
      runtimeSessionKey: string;
      approvalId?: string;
      decision?: "approve" | "reject";
      inputText?: string;
    }) {
      if (input.approvalId) {
        const approvalResolution = await client.resolveApproval({
          approvalId: input.approvalId,
          decision: input.decision ?? "approve",
        });

        if (!approvalResolution.accepted) {
          return approvalResolution;
        }

        if (input.inputText) {
          return client.sendInput({
            runtimeSessionKey: input.runtimeSessionKey,
            message: input.inputText,
          });
        }

        return approvalResolution;
      }

      if (input.inputText) {
        return client.sendInput({
          runtimeSessionKey: input.runtimeSessionKey,
          message: input.inputText,
        });
      }

      return { accepted: false };
    },
  };

  // Build the full adapter with orchestration methods
  const orchestrator = new OpenClawOrchestrator({ adapter: baseAdapter as OpenClawAdapter });

  const adapter: OpenClawAdapter = {
    ...baseAdapter,

    async executeTask(input: OpenClawExecuteTaskInput) {
      return orchestrator.executeTask(input);
    },

    async getSessionStatus(runtimeSessionKey: string) {
      return orchestrator.getSessionStatus(runtimeSessionKey);
    },
  };

  return adapter;
}

