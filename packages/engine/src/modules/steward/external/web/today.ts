type Call = (target: string, args?: Record<string, unknown>) => Promise<unknown>;
type App = { id: string; name: string; description: string | null; status: string; builtin: boolean; activeHash: string | null; origin: string; capabilities: unknown };
type Health = { module: string; moduleId: string; open: boolean; incident: { status: string; lastAt: string } | null; contractFailureCount: number; nextAction: string | null };
async function problems(call: Call) {
  const facts: Health[] = [];
  let cursor: string | null = null;
  do {
    const page = await call("modules.health", { limit: 100, ...(cursor ? { cursor } : {}) }) as { items: Health[]; nextCursor: string | null };
    facts.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return facts.filter(item => item.open).map(item => ({ module: item.module, moduleId: item.moduleId,
    incidentStatus: item.incident?.status === "recovered" ? null : item.incident?.status ?? null,
    contractFailures: item.contractFailureCount, nextAction: item.nextAction, since: item.incident?.lastAt ?? null,
  })).sort((a, b) => (b.since ?? "").localeCompare(a.since ?? "")).slice(0, 20);
}
async function optionalNotify(call: Call, target: string, args?: Record<string, unknown>) {
  try { return await call(target, args); }
  catch (error) {
    if (["not_found", "unavailable"].includes((error as { code?: string }).code ?? "")) return null;
    throw error;
  }
}
/** Web owns ordering and presentation; upcoming is an empty private page field without a schedule source. */
export async function todayView(call: Call, sessionsView: () => Promise<unknown[]>) {
  const [runtime, approvals, notifications, sessions, apps, issues, notificationStatus] = await Promise.all([
    call("activity.runtime"), call("approvals.list").then(page => (page as { items: unknown }).items), optionalNotify(call, "notify.list", { limit: 20 }),
    sessionsView().then(items => items.slice(0, 20)), call("modules.list").then(page => (page as { items: unknown }).items), problems(call), optionalNotify(call, "notify.status"),
  ]) as [{ at: string; [key: string]: unknown }, unknown[], { items: { format?: string; [key: string]: unknown }[] } | null, unknown[], App[], Awaited<ReturnType<typeof problems>>, { queued: number; failed: number } | null];
  const { at, ...health } = runtime;
  return { generatedAt: at, approvals, upcoming: [], updates: (notifications?.items ?? []).map(({ format: _format, ...item }) => item),
    apps: apps.map(({ id, name, description, status, builtin, activeHash, origin, capabilities }) => ({ id, name, description, status, builtin, activeHash, origin, capabilities })),
    problems: issues, sessions, health: { ...health, queuedNotifications: notificationStatus?.queued ?? 0, failedNotifications: notificationStatus?.failed ?? 0 } };
}
