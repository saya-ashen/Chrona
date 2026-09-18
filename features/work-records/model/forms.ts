import type { WorkEntry, WorkSourceInput } from "@chrona/contracts";
import { windowFromForm } from "./state";
export type WorkDialog = "report" | "source" | "change" | { entry: WorkEntry; decision: "apply" | "dismiss" };
export function sourceFromForm(form: FormData): WorkSourceInput {
  return { kind: String(form.get("sourceKind")) as WorkSourceInput["kind"], system: String(form.get("sourceSystem")), account: String(form.get("sourceAccount")), externalId: String(form.get("sourceExternalId")), label: String(form.get("sourceLabel")), ...(form.get("sourceUrl") ? { url: String(form.get("sourceUrl")) } : {}) };
}
export function updateAction(mode: WorkDialog, form: FormData) {
  if (typeof mode !== "string") return { type: "resolve", entryId: mode.entry.id, decision: mode.decision, reason: form.get("reason") };
  if (mode === "source") return { type: "source", source: sourceFromForm(form) };
  if (mode === "change") return { type: "propose", change: { type: form.get("changeType"), reason: form.get("reason"), ...(form.get("changeType") === "reschedule" ? { window: windowFromForm(form) } : {}) } };
  return { type: "report", summary: form.get("summary"), nextAction: form.get("nextAction"), needsAttention: form.get("clearAttention") !== "on",
    ...(form.get("dimension") !== "note" ? { signal: { dimension: form.get("dimension"), value: form.get("signalValue") } } : {}), ...(form.get("receiptRef") ? { receiptRef: form.get("receiptRef") } : {}) };
}
