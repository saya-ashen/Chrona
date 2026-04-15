import { OpenClawGatewayClient, type OpenClawRuntimeClient } from "@/modules/runtime/openclaw/client";
import { loadOpenClawPersistedDeviceIdentity } from "@/modules/runtime/openclaw/device-identity";
import { createMockOpenClawAdapter } from "@/modules/runtime/openclaw/mock-adapter";
import {
  getOpenClawTaskConfigSpec,
  OPENCLAW_RUNTIME_ADAPTER_KEY,
  OPENCLAW_RUNTIME_INPUT_VERSION,
  validateOpenClawTaskConfig,
} from "@/modules/runtime/openclaw/config";
import type { RuntimeInput } from "@/modules/runtime/types";
import type {
  OpenClawApprovalDecision,
  OpenClawChatHistory,
  OpenClawExecuteTaskInput,
  OpenClawExecuteTaskResult,
  OpenClawPendingApproval,
  OpenClawRunSnapshot,
  OpenClawSendInputResult,
  OpenClawSessionStatus,
} from "@/modules/runtime/openclaw/types";
import { OpenClawOrchestrator } from "@/modules/runtime/openclaw/orchestrator";

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

function resolveGatewayAuth(deviceToken?: string) {
  if (deviceToken) {
    return { deviceToken };
  }

  if (process.env.OPENCLAW_AUTH_TOKEN ?? process.env.OPENCLAW_API_KEY) {
    return { token: process.env.OPENCLAW_AUTH_TOKEN ?? process.env.OPENCLAW_API_KEY };
  }

  if (process.env.OPENCLAW_AUTH_PASSWORD) {
    return { password: process.env.OPENCLAW_AUTH_PASSWORD };
  }

  return {};
}

export async function createRuntimeAdapter(): Promise<OpenClawAdapter> {
  if (process.env.OPENCLAW_MODE === "mock") {
    return createMockOpenClawAdapter();
  }

  const deviceIdentity = await loadOpenClawPersistedDeviceIdentity({
    identityDir: process.env.OPENCLAW_IDENTITY_DIR,
  });
  const client = new OpenClawGatewayClient({
    gatewayUrl: process.env.OPENCLAW_GATEWAY_URL ?? process.env.OPENCLAW_BASE_URL ?? "",
    auth: resolveGatewayAuth(deviceIdentity?.deviceToken),
    deviceIdentity,
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
