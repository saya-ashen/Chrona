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
