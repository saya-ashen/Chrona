import { useState } from "react";
import { useI18n } from "@chrona/i18n";
import { Button } from "@shared/ui";
import type { WorkView } from "@chrona/contracts";
import { WorkCapture } from "./work-capture";
export function WorkRecordEnrollment({ taskId, title, view, refresh }: { taskId: string; title: string; view: WorkView; refresh: () => void }) {
  const c = useI18n().messages.workRecords, [open, setOpen] = useState(false);
  if (!view.canWrite) return null;
  return <div className="m-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
    <p className="max-w-2xl text-sm text-muted-foreground">{c.adoptIntro}</p><Button variant="outline" onClick={() => setOpen(true)}>{c.adopt}</Button>
    {open && <WorkCapture open onClose={() => setOpen(false)} onCaptured={refresh} existingTask={{ taskId, title, ...(view.schedule ? { window: { ...view.schedule, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } } : {}) }} />}
  </div>;
}
