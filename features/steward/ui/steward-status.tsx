import { useEffect, useState } from "react";
import type { StewardHealth } from "@chrona/contracts";
import { useI18n } from "@chrona/i18n";
import { stewardIsStale } from "../model/controls";

export function StewardStatus({ health }: { health?: StewardHealth }) {
  const { messages } = useI18n(), c = messages.steward, t = c.controls;
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  return <section aria-label={t.stewardStatus} className="space-y-1 text-sm">
    <h2 className="font-semibold">{t.stewardStatus}</h2>
    <p>{t.lastTick}: {health ? health.lastTickAt ?? t.never : c.notProvided} · {t.assessorName}: {health ? `${health.assessor.name} (${health.assessor.available ? t.available : t.unavailable})` : c.notProvided} · {c.pendingEvents}: {health?.pendingEvents ?? c.notProvided} · {t.queued}: {health?.queuedNotifications ?? c.notProvided}</p>
    {health && stewardIsStale(health.lastTickAt, now) && <p role="alert" className="font-medium text-destructive">{t.staleWarning}</p>}
  </section>;
}
