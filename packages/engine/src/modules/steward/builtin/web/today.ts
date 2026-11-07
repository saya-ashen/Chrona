type Call = (target: string, args?: Record<string, unknown>) => Promise<unknown>;
type Schedule = { id: string; mode: string; status: string; label: string | null; text: string; nextAt: string | null; until: string | null };
type App = { id: string; name: string; description: string | null; status: string; builtin: boolean; activeHash: string | null; origin: string; capabilities: unknown };
type Health = { module: string; moduleId: string; open: boolean; incident: { status: string; lastAt: string } | null; contractFailureCount: number; nextAction: string | null };
async function problems(call: Call) {
  const facts: Health[] = [];
  let cursor: string | null = null;
  do {
    const page = await call("modules.health", { open: "true", ...(cursor ? { cursor } : {}) }) as { items: Health[]; nextCursor: string | null };
    facts.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return facts.filter(item => item.open).map(item => ({ module: item.module, moduleId: item.moduleId,
    incidentStatus: item.incident?.status === "recovered" ? null : item.incident?.status ?? null,
    contractFailures: item.contractFailureCount, nextAction: item.nextAction, since: item.incident?.lastAt ?? null,
  })).sort((a, b) => (b.since ?? "").localeCompare(a.since ?? "")).slice(0, 20);
}
/** Web owns the overview horizon, ordering and presentation. Reads use existing governed module APIs. */
export async function todayView(call: Call) {
  const [runtime, approvals, schedules, notifications, sessions, apps, issues, notificationStatus] = await Promise.all([
    call("chat.runtime"), call("approvals.list"), call("schedules.list", { timers: true }), call("notify.list", { limit: 20 }).catch(() => ({ items: [] })),
    call("chat.sessions", { entries: true, limit: 20 }), call("modules.list"), problems(call).catch(() => []), call("notify.status").catch(() => null),
  ]) as [{ at: string; [key: string]: unknown }, unknown[], Schedule[], { items: { format?: string; [key: string]: unknown }[] }, unknown[], App[], Awaited<ReturnType<typeof problems>>, { queued: number; failed: number } | null];
  const { at, ...health } = runtime, now = Date.parse(at), end = now + 7 * 86400000;
  const upcoming = schedules.filter(schedule => schedule.status === "active" && schedule.nextAt && Date.parse(schedule.nextAt) >= now && Date.parse(schedule.nextAt) <= end && (!schedule.until || schedule.nextAt <= schedule.until))
    .sort((a, b) => a.nextAt!.localeCompare(b.nextAt!)).slice(0, 50)
    .map(schedule => ({ scheduleId: schedule.id, mode: schedule.mode, label: schedule.label ?? (schedule.mode === "module" ? schedule.text.slice(0, 300) : null), at: schedule.nextAt! }));
  return { generatedAt: at, approvals, upcoming, updates: notifications.items.map(({ format: _format, ...item }) => item),
    apps: apps.map(({ id, name, description, status, builtin, activeHash, origin, capabilities }) => ({ id, name, description, status, builtin, activeHash, origin, capabilities })),
    problems: issues, sessions, health: { ...health, queuedNotifications: notificationStatus?.queued ?? 0, failedNotifications: notificationStatus?.failed ?? 0 } };
}
