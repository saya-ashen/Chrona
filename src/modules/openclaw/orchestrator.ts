import type { OpenClawAdapter } from "@/modules/openclaw/adapter";
import type {
  OpenClawExecuteTaskInput,
  OpenClawExecuteTaskResult,
  OpenClawOrchestratorConfig,
  OpenClawOrchestratorEvent,
  OpenClawOrchestratorStrategy,
  OpenClawRunSnapshot,
  OpenClawSessionStatus,
  OpenClawTaskProgressEvent,
} from "@/modules/openclaw/types";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: OpenClawOrchestratorConfig = {
  strategy: "wait-for-completion",
  timeoutMs: 120_000,
  pollIntervalMs: 2_000,
  approvalStrategy: "auto-approve",
  maxRetries: 3,
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 30_000,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTerminalStatus(status: OpenClawRunSnapshot["status"]): boolean {
  return status === "Completed" || status === "Failed" || status === "Cancelled";
}

function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("connection closed") ||
    msg.includes("socket") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("network") ||
    msg.includes("unavailable") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504")
  );
}

function computeBackoffDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
): number {
  // Exponential backoff with jitter: base * 2^attempt + random jitter
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseMs * 0.5;
  return Math.min(exponential + jitter, maxMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// OpenClawOrchestrator
// ---------------------------------------------------------------------------

export type OpenClawOrchestratorOptions = {
  adapter: OpenClawAdapter;
  config?: Partial<OpenClawOrchestratorConfig>;
  onEvent?: (event: OpenClawOrchestratorEvent) => void;
};

export class OpenClawOrchestrator {
  private readonly adapter: OpenClawAdapter;
  private readonly config: OpenClawOrchestratorConfig;
  private readonly onEvent: ((event: OpenClawOrchestratorEvent) => void) | undefined;

  constructor(options: OpenClawOrchestratorOptions) {
    this.adapter = options.adapter;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.onEvent = options.onEvent;
  }

  // -------------------------------------------------------------------------
  // Public: executeTask — full lifecycle orchestration
  // -------------------------------------------------------------------------

  async executeTask(
    input: OpenClawExecuteTaskInput,
  ): Promise<OpenClawExecuteTaskResult> {
    const effectiveConfig = this.resolveEffectiveConfig(input);
    const startTime = Date.now();

    if (effectiveConfig.strategy === "fire-and-forget") {
      return this.executeFireAndForget(input, startTime);
    }

    // wait-for-completion or interactive
    return this.executeWithRetries(input, effectiveConfig, startTime);
  }

  // -------------------------------------------------------------------------
  // Public: getSessionStatus — retrieve current session state
  // -------------------------------------------------------------------------

  async getSessionStatus(
    runtimeSessionKey: string,
  ): Promise<OpenClawSessionStatus> {
    try {
      const [history, approvals] = await Promise.all([
        this.adapter.readHistory({ runtimeSessionKey }),
        this.adapter.listApprovals({ runtimeSessionKey }),
      ]);

      // If we got history, the session exists
      const exists = history.messages.length > 0 || approvals.length > 0;

      return {
        runtimeSessionKey,
        exists,
        pendingApprovals: approvals,
        lastMessage: exists && history.messages.length > 0
          ? extractLastMessageText(history.messages[history.messages.length - 1])
          : undefined,
      };
    } catch {
      return {
        runtimeSessionKey,
        exists: false,
        pendingApprovals: [],
      };
    }
  }

  // -------------------------------------------------------------------------
  // Private: fire-and-forget — start run, return immediately
  // -------------------------------------------------------------------------

  private async executeFireAndForget(
    input: OpenClawExecuteTaskInput,
    startTime: number,
  ): Promise<OpenClawExecuteTaskResult> {
    const createResult = await this.adapter.createRun({
      prompt: input.prompt,
      runtimeInput: input.runtimeInput,
      runtimeSessionKey: input.runtimeSessionKey,
    });

    if (createResult.runtimeRunRef) {
      this.emit({
        type: "run:started",
        runRef: createResult.runtimeRunRef,
        sessionKey: createResult.runtimeSessionKey ?? "",
        attempt: 1,
      });
    }

    return {
      success: createResult.runStarted,
      status: createResult.runStarted ? "Running" : "Pending",
      runtimeRunRef: createResult.runtimeRunRef,
      runtimeSessionKey: createResult.runtimeSessionKey,
      runtimeSessionRef: createResult.runtimeSessionRef,
      history: { messages: [] },
      attempts: 1,
      elapsedMs: Date.now() - startTime,
    };
  }

  // -------------------------------------------------------------------------
  // Private: execute with retries — full lifecycle with polling
  // -------------------------------------------------------------------------

  private async executeWithRetries(
    input: OpenClawExecuteTaskInput,
    config: {
      strategy: OpenClawOrchestratorStrategy;
      timeoutMs: number;
      pollIntervalMs: number;
      approvalStrategy: "auto-approve" | "auto-reject" | "skip";
      maxRetries: number;
    },
    startTime: number,
  ): Promise<OpenClawExecuteTaskResult> {
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
      try {
        const result = await this.executeSingleAttempt(
          input,
          config,
          startTime,
          attempt,
        );

        // If the run failed due to a transient-looking error and we have retries left,
        // retry. Otherwise return the result.
        if (
          result.status === "Failed" &&
          attempt <= config.maxRetries &&
          this.looksTransient(result.error || result.lastMessage)
        ) {
          lastError = result.error || result.lastMessage;
          const delayMs = computeBackoffDelay(
            attempt - 1,
            this.config.retryBaseDelayMs,
            this.config.retryMaxDelayMs,
          );

          this.emit({
            type: "run:retry",
            attempt: attempt + 1,
            reason: lastError ?? "Run failed with transient error",
            delayMs,
          });

          await sleep(delayMs);
          continue;
        }

        result.attempts = attempt;
        return result;
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : String(error);

        if (attempt <= config.maxRetries && isTransientError(error)) {
          lastError = errorMsg;
          const delayMs = computeBackoffDelay(
            attempt - 1,
            this.config.retryBaseDelayMs,
            this.config.retryMaxDelayMs,
          );

          this.emit({
            type: "run:retry",
            attempt: attempt + 1,
            reason: errorMsg,
            delayMs,
          });

          await sleep(delayMs);
          continue;
        }

        this.emit({
          type: "run:failed",
          error: errorMsg,
          attempt,
        });

        return {
          success: false,
          status: "Failed",
          history: { messages: [] },
          attempts: attempt,
          elapsedMs: Date.now() - startTime,
          error: errorMsg,
        };
      }
    }

    // Exhausted all retries
    return {
      success: false,
      status: "Failed",
      history: { messages: [] },
      attempts: config.maxRetries + 1,
      elapsedMs: Date.now() - startTime,
      error: lastError ?? "All retry attempts exhausted",
    };
  }

  // -------------------------------------------------------------------------
  // Private: single attempt — create run, poll, handle approvals
  // -------------------------------------------------------------------------

  private async executeSingleAttempt(
    input: OpenClawExecuteTaskInput,
    config: {
      strategy: OpenClawOrchestratorStrategy;
      timeoutMs: number;
      pollIntervalMs: number;
      approvalStrategy: "auto-approve" | "auto-reject" | "skip";
    },
    startTime: number,
    attempt: number,
  ): Promise<OpenClawExecuteTaskResult> {
    // 1. Create or reuse session and start run
    const createResult = await this.adapter.createRun({
      prompt: input.prompt,
      runtimeInput: input.runtimeInput,
      runtimeSessionKey: input.runtimeSessionKey,
    });

    const runtimeRunRef = createResult.runtimeRunRef;
    const runtimeSessionKey =
      createResult.runtimeSessionKey ?? input.runtimeSessionKey;

    if (!runtimeRunRef) {
      return {
        success: false,
        status: "Failed",
        runtimeSessionKey,
        runtimeSessionRef: createResult.runtimeSessionRef,
        history: { messages: [] },
        attempts: attempt,
        elapsedMs: Date.now() - startTime,
        error: "No run reference returned from createRun",
      };
    }

    this.emit({
      type: "run:started",
      runRef: runtimeRunRef,
      sessionKey: runtimeSessionKey ?? "",
      attempt,
    });

    // 2. Poll until terminal status or timeout
    const deadline = startTime + config.timeoutMs;
    let lastSnapshot: OpenClawRunSnapshot | undefined;

    while (Date.now() < deadline) {
      // Use a short waitForRun timeout so we can check our own deadline
      const pollTimeout = Math.min(config.pollIntervalMs, deadline - Date.now());
      if (pollTimeout <= 0) break;

      const snapshot = await this.adapter.getRunSnapshot({
        runtimeRunRef,
        runtimeSessionKey,
        timeoutMs: pollTimeout,
      });

      lastSnapshot = snapshot;

      // Emit progress
      const elapsed = Date.now() - startTime;
      const progressEvent: OpenClawTaskProgressEvent = {
        status: snapshot.status,
        runtimeRunRef,
        runtimeSessionKey,
        message: snapshot.lastMessage,
        attempt,
        elapsedMs: elapsed,
      };
      input.onProgress?.(progressEvent);

      this.emit({
        type: "run:progress",
        status: snapshot.status,
        message: snapshot.lastMessage,
        elapsedMs: elapsed,
      });

      // 3. Handle terminal states
      if (isTerminalStatus(snapshot.status)) {
        const history = runtimeSessionKey
          ? await this.adapter.readHistory({ runtimeSessionKey })
          : { messages: [] };

        const result: OpenClawExecuteTaskResult = {
          success: snapshot.status === "Completed",
          status: snapshot.status,
          runtimeRunRef,
          runtimeSessionKey,
          runtimeSessionRef: snapshot.runtimeSessionRef,
          lastMessage: snapshot.lastMessage,
          history,
          attempts: attempt,
          elapsedMs: Date.now() - startTime,
          error: snapshot.status === "Failed" ? snapshot.lastMessage : undefined,
        };

        this.emit({ type: "run:completed", result });
        return result;
      }

      // 4. Handle approval requests
      if (
        snapshot.status === "WaitingForApproval" &&
        config.approvalStrategy !== "skip" &&
        runtimeSessionKey
      ) {
        await this.handleApprovals(runtimeSessionKey, config.approvalStrategy);
      }

      // 5. Wait before next poll (if not already past deadline)
      if (Date.now() < deadline) {
        const waitTime = Math.min(config.pollIntervalMs, deadline - Date.now());
        if (waitTime > 0) {
          await sleep(waitTime);
        }
      }
    }

    // Timed out
    const history = runtimeSessionKey
      ? await this.adapter.readHistory({ runtimeSessionKey })
      : { messages: [] };

    return {
      success: false,
      status: lastSnapshot?.status ?? "Running",
      runtimeRunRef,
      runtimeSessionKey,
      runtimeSessionRef: lastSnapshot?.runtimeSessionRef,
      lastMessage: lastSnapshot?.lastMessage ?? "Execution timed out",
      history,
      attempts: attempt,
      elapsedMs: Date.now() - startTime,
      error: `Timed out after ${config.timeoutMs}ms`,
    };
  }

  // -------------------------------------------------------------------------
  // Private: handle pending approvals
  // -------------------------------------------------------------------------

  private async handleApprovals(
    runtimeSessionKey: string,
    strategy: "auto-approve" | "auto-reject",
  ): Promise<void> {
    const approvals = await this.adapter.listApprovals({ runtimeSessionKey });

    for (const approval of approvals) {
      const decision = strategy === "auto-approve" ? "approve" : "reject";

      try {
        await this.adapter.resumeRun({
          runtimeSessionKey,
          approvalId: approval.approvalId,
          decision,
        });

        this.emit({
          type: "run:approval-handled",
          approvalId: approval.approvalId,
          decision,
        });
      } catch {
        // Approval may have already been resolved; continue
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private: helpers
  // -------------------------------------------------------------------------

  private resolveEffectiveConfig(input: OpenClawExecuteTaskInput) {
    return {
      strategy: this.config.strategy,
      timeoutMs: input.timeoutMs ?? this.config.timeoutMs,
      pollIntervalMs: input.pollIntervalMs ?? this.config.pollIntervalMs,
      approvalStrategy: input.approvalStrategy ?? this.config.approvalStrategy,
      maxRetries: input.maxRetries ?? this.config.maxRetries,
    };
  }

  private looksTransient(message: string | undefined): boolean {
    if (!message) return false;
    const lower = message.toLowerCase();
    return (
      lower.includes("timeout") ||
      lower.includes("timed out") ||
      lower.includes("connection") ||
      lower.includes("unavailable") ||
      lower.includes("rate limit") ||
      lower.includes("throttl") ||
      lower.includes("temporary") ||
      lower.includes("retry")
    );
  }

  private emit(event: OpenClawOrchestratorEvent): void {
    this.onEvent?.(event);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createOrchestrator(
  options: OpenClawOrchestratorOptions,
): OpenClawOrchestrator {
  return new OpenClawOrchestrator(options);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function extractLastMessageText(
  message: Record<string, unknown> | undefined,
): string | undefined {
  if (!message) return undefined;

  // Handle content as string
  if (typeof message.content === "string") return message.content;

  // Handle content as array with text entries
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof (part as Record<string, unknown>).text === "string"
      ) {
        return (part as Record<string, unknown>).text as string;
      }
    }
  }

  return undefined;
}
