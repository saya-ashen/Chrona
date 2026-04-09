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
