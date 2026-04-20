export type GateCheckName =
  | "create_run"
  | "query_status"
  | "read_outputs"
  | "resume_after_wait";

export type GateCheckResult = {
  name: GateCheckName;
  passed: boolean;
  evidence: string;
};

export type GateReport = {
  overall: "pass" | "fail";
  checks: GateCheckResult[];
};

export type OpenClawConnectAuth = {
  token?: string;
  password?: string;
  deviceToken?: string;
};

export type OpenClawDeviceIdentity = {
  deviceId: string;
  publicKey: string;
  sign: (payload: string) => Promise<string>;
  deviceToken?: string;
  platform?: string;
  deviceFamily?: string;
};

export type OpenClawHello = {
  protocol: number;
  methods: string[];
};

export type OpenClawRunSnapshot = {
  runtimeRunRef: string;
  runtimeSessionRef?: string;
  runtimeSessionKey?: string;
  status:
    | "Pending"
    | "Running"
    | "WaitingForInput"
    | "WaitingForApproval"
    | "Failed"
    | "Completed"
    | "Cancelled";
  rawStatus?: string;
  lastMessage?: string;
};

export type OpenClawChatHistory = {
  messages: Array<Record<string, unknown>>;
};

export type OpenClawApprovalRequest = {
  command: string;
  commandArgv?: string[];
  cwd?: string;
  sessionKey?: string;
  host?: "gateway" | "node";
};

export type OpenClawApprovalRequestResult = {
  approvalId: string;
  status?: string;
};

export type OpenClawApprovalResolution = {
  approvalId: string;
  decision: "approve" | "reject";
};

export type OpenClawApprovalDecision = "allow-once" | "allow-always" | "deny";

export type OpenClawPendingApproval = {
  approvalId: string;
  sessionKey?: string;
  host?: string;
  command?: string;
  ask?: string;
  createdAtMs?: number;
  expiresAtMs?: number;
};

export type OpenClawSendInput = {
  runtimeSessionKey: string;
  message: string;
};

export type OpenClawSendInputResult = {
  accepted: boolean;
  runtimeRunRef?: string;
  runtimeSessionKey?: string;
  runStarted: boolean;
};

// ---------------------------------------------------------------------------
// Orchestration types
// ---------------------------------------------------------------------------

export type OpenClawExecuteTaskInput = {
  prompt: string;
  runtimeInput: RuntimeInput;
  runtimeSessionKey?: string;
  /** Maximum time (ms) to wait for the run to reach a terminal state. Default: 120_000 */
  timeoutMs?: number;
  /** Interval (ms) between status polls. Default: 2_000 */
  pollIntervalMs?: number;
  /** How to handle approval requests. Default: "auto-approve" */
  approvalStrategy?: "auto-approve" | "auto-reject" | "skip";
  /** Maximum number of retries on transient failures. Default: 3 */
  maxRetries?: number;
  /** Called on each status poll (for progress tracking). */
  onProgress?: (event: OpenClawTaskProgressEvent) => void;
};

export type OpenClawTaskProgressEvent = {
  status: OpenClawRunSnapshot["status"];
  runtimeRunRef?: string;
  runtimeSessionKey?: string;
  message?: string;
  attempt: number;
  elapsedMs: number;
};

export type OpenClawExecuteTaskResult = {
  success: boolean;
  status: OpenClawRunSnapshot["status"];
  runtimeRunRef?: string;
  runtimeSessionKey?: string;
  runtimeSessionRef?: string;
  lastMessage?: string;
  history: OpenClawChatHistory;
  attempts: number;
  elapsedMs: number;
  error?: string;
};

export type OpenClawSessionStatus = {
  runtimeSessionKey: string;
  exists: boolean;
  activeRunRef?: string;
  activeRunStatus?: OpenClawRunSnapshot["status"];
  pendingApprovals: OpenClawPendingApproval[];
  lastMessage?: string;
};

export type RuntimeInput = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Orchestrator types
// ---------------------------------------------------------------------------

export type OpenClawOrchestratorStrategy =
  | "wait-for-completion"
  | "fire-and-forget"
  | "interactive";

export type OpenClawOrchestratorConfig = {
  /** Execution strategy. Default: "wait-for-completion" */
  strategy: OpenClawOrchestratorStrategy;
  /** Maximum time (ms) to wait for completion. Default: 120_000 */
  timeoutMs: number;
  /** Interval (ms) between status polls. Default: 2_000 */
  pollIntervalMs: number;
  /** How to handle approvals. Default: "auto-approve" */
  approvalStrategy: "auto-approve" | "auto-reject" | "skip";
  /** Maximum retries on transient failures. Default: 3 */
  maxRetries: number;
  /** Base delay (ms) for exponential backoff. Default: 1_000 */
  retryBaseDelayMs: number;
  /** Maximum delay (ms) for exponential backoff. Default: 30_000 */
  retryMaxDelayMs: number;
};

export type OpenClawOrchestratorEvent =
  | { type: "run:started"; runRef: string; sessionKey: string; attempt: number }
  | { type: "run:progress"; status: OpenClawRunSnapshot["status"]; message?: string; elapsedMs: number }
  | { type: "run:approval-handled"; approvalId: string; decision: "approve" | "reject" }
  | { type: "run:retry"; attempt: number; reason: string; delayMs: number }
  | { type: "run:completed"; result: OpenClawExecuteTaskResult }
  | { type: "run:failed"; error: string; attempt: number };
