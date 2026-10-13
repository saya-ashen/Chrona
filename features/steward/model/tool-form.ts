import { handlingSignalsSchema } from "@chrona/contracts";
import type { z } from "zod";
export type HandlingSignals = z.output<typeof handlingSignalsSchema>;
export const initialSignals: HandlingSignals = { repeatsExpected: "once", rulesStable: false, needsOngoingObservation: false, needsUserInteraction: "none", ambiguity: "clear", existingToolFits: false, risk: "low", valueWorthKeeping: false };
export const signalOptions = {
  repeatsExpected: ["once", "few", "recurring"], rulesStable: ["false", "true"], needsOngoingObservation: ["false", "true"], needsUserInteraction: ["none", "read", "compare_or_fill"], ambiguity: ["clear", "fuzzy"], existingToolFits: ["false", "true"], risk: ["low", "high"], valueWorthKeeping: ["false", "true"],
} as const;
export const signalKeys = Object.keys(signalOptions) as (keyof HandlingSignals)[];
export function updateSignal(signals: HandlingSignals, key: keyof HandlingSignals, value: string): HandlingSignals {
  return handlingSignalsSchema.parse({ ...signals, [key]: value === "true" ? true : value === "false" ? false : value });
}
