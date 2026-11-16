export type KernelModelCaps = {
  maxCallsPerEvent: number;
  maxOutputTokens: number;
  dailyCalls: number;
  eventTimeoutMs: number;
  moduleDailyCalls?: Record<string, number>;
};
export type GlobalSettings = {
  timezone: string;
  runTimeoutMinutes?: number | null;
  moduleModel?: KernelModelCaps | null;
  modelUsage?: { module: string; calls: number; inputTokens: number; outputTokens: number; unreportedCalls?: number }[];
};
export type SettingsView = { settings: GlobalSettings };

export type LoginMode = "login" | "setup" | "bootstrap" | "error";

export type Approval = { id: string; title: string; detail?: string | null; preview?: string | null; createdAt: string; moduleId?: string | null };
export type Interaction = {
  id: string; expiresAt: string; status: string;
  question: { title: string; message?: string; method: string; options?: string[]; prefill?: string } };
