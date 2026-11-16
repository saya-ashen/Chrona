import type { ProviderAdapter } from "@chrona/contracts/steward";

export const liveRuns = new Map<string, ReturnType<ProviderAdapter["start"]>>();
