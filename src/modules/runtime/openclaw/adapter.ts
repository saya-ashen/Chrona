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
  OpenClawPendingApproval,
  OpenClawRunSnapshot,
  OpenClawSendInputResult,
} from "@/modules/runtime/openclaw/types";

export {
  getOpenClawTaskConfigSpec,
  OPENCLAW_RUNTIME_ADAPTER_KEY,
  OPENCLAW_RUNTIME_INPUT_VERSION,
  validateOpenClawTaskConfig,
};

export type OpenClawAdapter = {
  createRun(input: { prompt: string; runtimeInput: RuntimeInput }): Promise<{
    runtimeRunRef?: string;
    runtimeSessionRef?: string;
    runtimeSessionKey?: string;
    runStarted: boolean;
  }>;
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
  return {
    async createRun(input) {
      return client.createRun({ prompt: input.prompt });
    },
    async getRunSnapshot(input) {
      return client.waitForRun(input.runtimeRunRef, input.timeoutMs ?? 250);
    },
    async readHistory(input) {
      return client.readOutputs(input.runtimeSessionKey);
    },
    async listApprovals(input) {
      return (await client.listApprovals()).filter(
        (approval) => approval.sessionKey === input.runtimeSessionKey,
      );
    },
    async waitForApprovalDecision(approvalId) {
      try {
        return await client.waitForApprovalDecision(approvalId);
      } catch {
        return null;
      }
    },
    async resumeRun(input) {
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
}
