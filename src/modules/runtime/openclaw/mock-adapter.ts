import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawAdapter } from "@/modules/runtime/openclaw/adapter";
import type {
  OpenClawApprovalDecision,
  OpenClawChatHistory,
  OpenClawPendingApproval,
  OpenClawRunSnapshot,
} from "@/modules/runtime/openclaw/types";

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
    async createRun() {
      return {
        runtimeRunRef: fixture.snapshot.runtimeRunRef,
        runtimeSessionRef: fixture.snapshot.runtimeSessionRef,
        runtimeSessionKey: fixture.snapshot.runtimeSessionKey,
        runStarted: true,
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
  };
}
