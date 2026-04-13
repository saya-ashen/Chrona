import { StatusBadge } from "@/components/ui/status-badge";

import type { WorkPageData, WorkbenchCopy } from "./work-page-types";

type CurrentStepCalloutProps = {
  intervention: WorkPageData["currentIntervention"];
  currentStep: WorkPageData["taskPlan"]["steps"][number] | null;
  copy: WorkbenchCopy;
};

function getEvidenceTone(tone: "neutral" | "warning" | "critical") {
  switch (tone) {
    case "warning":
      return "warning" as const;
    case "critical":
      return "critical" as const;
    default:
      return "info" as const;
  }
}

export function CurrentStepCallout({
  intervention,
  currentStep,
  copy,
}: CurrentStepCalloutProps) {
  if (!intervention) {
    return null;
  }

  return (
    <section className="overflow-hidden rounded-[24px] border border-slate-900/75 bg-[linear-gradient(180deg,rgba(15,23,42,0.97),rgba(15,23,42,0.93))] px-5 py-5 text-primary-foreground shadow-[0_18px_40px_rgba(15,23,42,0.14)] sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="info">{copy.currentStep}</StatusBadge>
        {currentStep ? <StatusBadge tone="warning">{currentStep.title}</StatusBadge> : null}
      </div>

      <h3 className="mt-3 text-xl font-semibold tracking-tight">{intervention.title}</h3>
      <p className="mt-2 text-sm leading-6 text-primary-foreground/80">{intervention.description}</p>

      <div className="mt-4 rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-primary-foreground/[0.62]">
          {copy.whyNow}
        </p>
        <p className="mt-2 text-sm leading-6 text-primary-foreground/84">{intervention.whyNow}</p>
      </div>

      {intervention.evidence.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {intervention.evidence.map((item) => (
            <div key={`${item.label}-${item.value}`}>
              {item.href ? (
                <a href={item.href} className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-3 py-1.5 text-xs text-primary-foreground/85 hover:bg-white/[0.08]">
                  <StatusBadge tone={getEvidenceTone(item.tone)}>{item.label}</StatusBadge>
                  <span>{item.value}</span>
                </a>
              ) : (
                <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-3 py-1.5 text-xs text-primary-foreground/85">
                  <StatusBadge tone={getEvidenceTone(item.tone)}>{item.label}</StatusBadge>
                  <span>{item.value}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
