import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawAdapter } from "./adapter";
import type {
  OpenClawApprovalDecision,
  OpenClawChatHistory,
  OpenClawPendingApproval,
  OpenClawRunSnapshot,
} from "../protocol/types";

// ---------------------------------------------------------------------------
// Fixture-based mock (backward-compatible)
// ---------------------------------------------------------------------------

type OpenClawMockFixtureName = "run-waiting-approval" | "run-completed";

type OpenClawMockFixture = {
  snapshot: OpenClawRunSnapshot;
  history: OpenClawChatHistory;
  approvals: OpenClawPendingApproval[];
  approvalDecisions?: Record<string, OpenClawApprovalDecision | null>;
};

function loadFixture(name: OpenClawMockFixtureName): OpenClawMockFixture {
  const fixturePath = join(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    `${name}.json`,
  );

  return JSON.parse(readFileSync(fixturePath, "utf8")) as OpenClawMockFixture;
}

export function createMockOpenClawAdapter(options?: {
  fixtureName?: OpenClawMockFixtureName;
  fixture?: OpenClawMockFixture;
}): OpenClawAdapter {
  const fixture = options?.fixture ?? loadFixture(options?.fixtureName ?? "run-waiting-approval");

  return {
    async createRun(input) {
      return {
        runtimeRunRef: fixture.snapshot.runtimeRunRef,
        runtimeSessionRef: fixture.snapshot.runtimeSessionRef,
        runtimeSessionKey: input.runtimeSessionKey ?? fixture.snapshot.runtimeSessionKey,
        runStarted: true,
      };
    },
    async sendOperatorMessage(input) {
      return {
        accepted: true,
        runtimeRunRef: fixture.snapshot.runtimeRunRef,
        runtimeSessionKey: input.runtimeSessionKey,
        runStarted: false,
      };
    },
    async getRunSnapshot() {
      return fixture.snapshot;
    },
    async readHistory() {
      return fixture.history;
    },
    async listApprovals(input) {
      return fixture.approvals.filter(
        (approval) => approval.sessionKey === input.runtimeSessionKey,
      );
    },
    async waitForApprovalDecision(approvalId) {
      return fixture.approvalDecisions?.[approvalId] ?? null;
    },
    async resumeRun() {
      return { accepted: true };
    },
    async executeTask(input) {
      const startTime = Date.now();
      const sessionKey = input.runtimeSessionKey ?? fixture.snapshot.runtimeSessionKey;
      return {
        success: fixture.snapshot.status === "Completed",
        status: fixture.snapshot.status,
        runtimeRunRef: fixture.snapshot.runtimeRunRef,
        runtimeSessionKey: sessionKey,
        runtimeSessionRef: fixture.snapshot.runtimeSessionRef,
        lastMessage: fixture.snapshot.lastMessage,
        history: fixture.history,
        attempts: 1,
        elapsedMs: Date.now() - startTime,
      };
    },
    async getSessionStatus(runtimeSessionKey) {
      const approvals = fixture.approvals.filter(
        (a) => a.sessionKey === runtimeSessionKey,
      );
      return {
        runtimeSessionKey,
        exists: true,
        activeRunRef: fixture.snapshot.runtimeRunRef,
        activeRunStatus: fixture.snapshot.status,
        pendingApprovals: approvals,
        lastMessage: fixture.snapshot.lastMessage,
      };
    },
  };
}
