import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawAdapter } from "@/modules/runtime/openclaw/adapter";
import type {
  OpenClawApprovalDecision,
  OpenClawChatHistory,
  OpenClawExecuteTaskInput,
  OpenClawExecuteTaskResult,
  OpenClawPendingApproval,
  OpenClawRunSnapshot,
  OpenClawSessionStatus,
} from "@/modules/runtime/openclaw/types";

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

// ---------------------------------------------------------------------------
// Stateful mock adapter — simulates realistic agent behavior
// ---------------------------------------------------------------------------

export type StatefulMockOptions = {
  /** Milliseconds before a run transitions from Running to its terminal state (default: 0) */
  completionDelay?: number;
  /** Whether runs auto-complete. When false runs stay Running until manually advanced. (default: true) */
  autoComplete?: boolean;
  /** Probability 0–1 that a run ends as Failed instead of Completed (default: 0) */
  failRate?: number;
  /** Whether runs generate an approval request before completing (default: false) */
  requireApproval?: boolean;
  /** Custom response text the mock assistant produces (default: generated) */
  simulatedResponse?: string;
};

type ChatMessage = {
  role: "user" | "assistant" | "toolResult";
  content: string;
  id: string;
  ts: number;
};

type MockRun = {
  runId: string;
  sessionKey: string;
  status: OpenClawRunSnapshot["status"];
  prompt: string;
  createdAt: number;
  completionTimer?: ReturnType<typeof setTimeout>;
  lastMessage?: string;
};

type MockSession = {
  sessionKey: string;
  sessionRef: string;
  runs: MockRun[];
  messages: ChatMessage[];
  approvals: OpenClawPendingApproval[];
  approvalDecisions: Record<string, OpenClawApprovalDecision | null>;
};

export type StatefulMockInternals = {
  /** Manually advance a run to a given status (useful when autoComplete=false) */
  advanceRun(runId: string, status: OpenClawRunSnapshot["status"]): void;
  /** Look up internal session state by session key */
  getSession(sessionKey: string): MockSession | undefined;
  /** Look up internal run state */
  getRun(runId: string): MockRun | undefined;
  /** Add a pending approval for a session (to simulate external approval requests) */
  addApproval(sessionKey: string, approval: Omit<OpenClawPendingApproval, "sessionKey">): void;
  /** Record an approval decision */
  setApprovalDecision(approvalId: string, decision: OpenClawApprovalDecision): void;
};

export type StatefulMockAdapter = OpenClawAdapter & {
  /** Access internal state for test assertions */
  _internals: StatefulMockInternals;
};

export function createStatefulMockAdapter(
  options?: StatefulMockOptions,
): StatefulMockAdapter {
  const opts: Required<StatefulMockOptions> = {
    completionDelay: options?.completionDelay ?? 0,
    autoComplete: options?.autoComplete ?? true,
    failRate: options?.failRate ?? 0,
    requireApproval: options?.requireApproval ?? false,
    simulatedResponse: options?.simulatedResponse ?? "",
  };

  // Internal state stores
  const sessions = new Map<string, MockSession>();
  const runIndex = new Map<string, MockRun>();

  // ---- helpers ----

  function ensureSession(sessionKey: string): MockSession {
    let session = sessions.get(sessionKey);
    if (!session) {
      session = {
        sessionKey,
        sessionRef: `session_${randomUUID()}`,
        runs: [],
        messages: [],
        approvals: [],
        approvalDecisions: {},
      };
      sessions.set(sessionKey, session);
    }
    return session;
  }

  function generateResponse(prompt: string): string {
    if (opts.simulatedResponse) return opts.simulatedResponse;
    return `Mock response to: ${prompt}`;
  }

  function shouldFail(): boolean {
    return Math.random() < opts.failRate;
  }

  function scheduleCompletion(run: MockRun, session: MockSession) {
    if (!opts.autoComplete) return;

    const complete = () => {
      if (run.status !== "Running") return; // already transitioned

      if (opts.requireApproval) {
        run.status = "WaitingForApproval";
        const approvalId = `approval_${randomUUID()}`;
        const approval: OpenClawPendingApproval = {
          approvalId,
          sessionKey: session.sessionKey,
          host: "gateway",
          command: "mock_command",
          ask: "Approve this mock action?",
          createdAtMs: Date.now(),
          expiresAtMs: Date.now() + 3_600_000,
        };
        session.approvals.push(approval);
        session.approvalDecisions[approvalId] = null;
        run.lastMessage = "Waiting for approval to continue.";
        return;
      }

      if (shouldFail()) {
        run.status = "Failed";
        run.lastMessage = "Mock run failed.";
        return;
      }

      run.status = "Completed";
      const responseText = generateResponse(run.prompt);
      run.lastMessage = responseText;

      // Add assistant message to session history
      session.messages.push({
        role: "assistant",
        content: responseText,
        id: `msg_${randomUUID()}`,
        ts: Date.now(),
      });
    };

    if (opts.completionDelay > 0) {
      run.completionTimer = setTimeout(complete, opts.completionDelay);
    } else {
      complete();
    }
  }

  function createRun(session: MockSession, prompt: string): MockRun {
    const runId = `run_${randomUUID()}`;
    const now = Date.now();

    // Add user message to history
    session.messages.push({
      role: "user",
      content: prompt,
      id: `msg_${randomUUID()}`,
      ts: now,
    });

    const run: MockRun = {
      runId,
      sessionKey: session.sessionKey,
      status: "Running",
      prompt,
      createdAt: now,
    };

    session.runs.push(run);
    runIndex.set(runId, run);

    scheduleCompletion(run, session);

    return run;
  }

  // ---- internals ----

  const internals: StatefulMockInternals = {
    advanceRun(runId, status) {
      const run = runIndex.get(runId);
      if (!run) throw new Error(`Run not found: ${runId}`);

      // Clear any pending timer
      if (run.completionTimer) {
        clearTimeout(run.completionTimer);
        run.completionTimer = undefined;
      }

      run.status = status;

      if (status === "Completed") {
        const session = sessions.get(run.sessionKey);
        const responseText = generateResponse(run.prompt);
        run.lastMessage = responseText;
        if (session) {
          session.messages.push({
            role: "assistant",
            content: responseText,
            id: `msg_${randomUUID()}`,
            ts: Date.now(),
          });
        }
      } else if (status === "Failed") {
        run.lastMessage = "Mock run failed.";
      }
    },

    getSession(sessionKey) {
      return sessions.get(sessionKey);
    },

    getRun(runId) {
      return runIndex.get(runId);
    },

    addApproval(sessionKey, approval) {
      const session = ensureSession(sessionKey);
      const full: OpenClawPendingApproval = { ...approval, sessionKey };
      session.approvals.push(full);
      session.approvalDecisions[approval.approvalId] = null;
    },

    setApprovalDecision(approvalId, decision) {
      for (const session of sessions.values()) {
        if (approvalId in session.approvalDecisions) {
          session.approvalDecisions[approvalId] = decision;

          // If a run is waiting for approval, transition it
          for (const run of session.runs) {
            if (run.status === "WaitingForApproval") {
              if (decision === "deny") {
                run.status = "Failed";
                run.lastMessage = "Approval denied.";
              } else {
                run.status = "Completed";
                const responseText = generateResponse(run.prompt);
                run.lastMessage = responseText;
                session.messages.push({
                  role: "assistant",
                  content: responseText,
                  id: `msg_${randomUUID()}`,
                  ts: Date.now(),
                });
              }
              break;
            }
          }
          return;
        }
      }
    },
  };

  // ---- adapter methods ----

  const adapter: StatefulMockAdapter = {
    _internals: internals,

    async createRun(input) {
      const sessionKey =
        input.runtimeSessionKey ?? `session_${randomUUID()}`;
      const session = ensureSession(sessionKey);
      const run = createRun(session, input.prompt);

      return {
        runtimeRunRef: run.runId,
        runtimeSessionRef: session.sessionRef,
        runtimeSessionKey: session.sessionKey,
        runStarted: true,
      };
    },

    async sendOperatorMessage(input) {
      const session = sessions.get(input.runtimeSessionKey);
      if (!session) {
        return {
          accepted: false,
          runtimeSessionKey: input.runtimeSessionKey,
          runStarted: false,
        };
      }

      const run = createRun(session, input.message);

      return {
        accepted: true,
        runtimeRunRef: run.runId,
        runtimeSessionKey: session.sessionKey,
        runStarted: true,
      };
    },

    async getRunSnapshot(input) {
      const run = runIndex.get(input.runtimeRunRef);
      if (!run) {
        return {
          runtimeRunRef: input.runtimeRunRef,
          runtimeSessionKey: input.runtimeSessionKey,
          status: "Failed" as const,
          lastMessage: "Run not found",
        };
      }

      const session = sessions.get(run.sessionKey);

      return {
        runtimeRunRef: run.runId,
        runtimeSessionRef: session?.sessionRef,
        runtimeSessionKey: run.sessionKey,
        status: run.status,
        lastMessage: run.lastMessage,
      };
    },

    async readHistory(input) {
      const session = sessions.get(input.runtimeSessionKey);
      if (!session) {
        return { messages: [] };
      }

      return {
        messages: session.messages.map((msg) => ({
          role: msg.role,
          content: [{ type: "text", text: msg.content }],
          timestamp: msg.ts,
          __openclaw: { id: msg.id, seq: 0 },
        })),
      };
    },

    async listApprovals(input) {
      const session = sessions.get(input.runtimeSessionKey);
      if (!session) return [];

      return session.approvals.filter(
        (a) => session.approvalDecisions[a.approvalId] === null,
      );
    },

    async waitForApprovalDecision(approvalId) {
      for (const session of sessions.values()) {
        const decision = session.approvalDecisions[approvalId];
        if (decision !== undefined) return decision;
      }
      return null;
    },

    async resumeRun(input) {
      const session = sessions.get(input.runtimeSessionKey);
      if (!session) return { accepted: false };

      if (input.approvalId && input.decision) {
        const decision: OpenClawApprovalDecision =
          input.decision === "approve" ? "allow-once" : "deny";
        internals.setApprovalDecision(input.approvalId, decision);
      }

      if (input.inputText) {
        const run = createRun(session, input.inputText);
        return {
          accepted: true,
          runtimeRunRef: run.runId,
          runtimeSessionKey: session.sessionKey,
          runStarted: true,
        };
      }

      return { accepted: true };
    },

    async executeTask(input) {
      const startTime = Date.now();
      const sessionKey = input.runtimeSessionKey ?? `session_${randomUUID()}`;
      const session = ensureSession(sessionKey);
      const run = createRun(session, input.prompt);
      const maxRetries = input.maxRetries ?? 3;
      const approvalStrategy = input.approvalStrategy ?? "auto-approve";
      let attempts = 1;

      // Simulate retry logic: if run failed with transient error and retries left, retry
      while (
        run.status === "Failed" &&
        attempts <= maxRetries &&
        run.lastMessage?.toLowerCase().includes("timeout")
      ) {
        attempts++;
        run.status = "Running";
        scheduleCompletion(run, session);
      }

      // Handle approvals automatically if configured
      if (run.status === "WaitingForApproval" && approvalStrategy !== "skip") {
        const pendingApprovals = session.approvals.filter(
          (a) => session.approvalDecisions[a.approvalId] === null,
        );
        for (const approval of pendingApprovals) {
          const decision: OpenClawApprovalDecision =
            approvalStrategy === "auto-approve" ? "allow-once" : "deny";
          internals.setApprovalDecision(approval.approvalId, decision);
        }
      }

      const history: OpenClawChatHistory = {
        messages: session.messages.map((msg) => ({
          role: msg.role,
          content: [{ type: "text", text: msg.content }],
          timestamp: msg.ts,
          __openclaw: { id: msg.id, seq: 0 },
        })),
      };

      const result: OpenClawExecuteTaskResult = {
        success: run.status === "Completed",
        status: run.status,
        runtimeRunRef: run.runId,
        runtimeSessionKey: session.sessionKey,
        runtimeSessionRef: session.sessionRef,
        lastMessage: run.lastMessage,
        history,
        attempts,
        elapsedMs: Date.now() - startTime,
        error: run.status === "Failed" ? run.lastMessage : undefined,
      };

      input.onProgress?.({
        status: run.status,
        runtimeRunRef: run.runId,
        runtimeSessionKey: session.sessionKey,
        message: run.lastMessage,
        attempt: attempts,
        elapsedMs: Date.now() - startTime,
      });

      return result;
    },

    async getSessionStatus(runtimeSessionKey) {
      const session = sessions.get(runtimeSessionKey);
      if (!session) {
        return {
          runtimeSessionKey,
          exists: false,
          pendingApprovals: [],
        } satisfies OpenClawSessionStatus;
      }

      const activeRun = session.runs.find(
        (r) => r.status === "Running" || r.status === "Pending" ||
               r.status === "WaitingForApproval" || r.status === "WaitingForInput",
      );

      const pendingApprovals = session.approvals.filter(
        (a) => session.approvalDecisions[a.approvalId] === null,
      );

      const lastRun = session.runs[session.runs.length - 1];

      return {
        runtimeSessionKey,
        exists: true,
        activeRunRef: activeRun?.runId,
        activeRunStatus: activeRun?.status,
        pendingApprovals,
        lastMessage: lastRun?.lastMessage,
      } satisfies OpenClawSessionStatus;
    },
  };

  return adapter;
}
