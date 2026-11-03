import { createHash } from "node:crypto";
import { on, chrona } from "chrona";

type Timer = { key: string; label: string | null; status: string; nextAt: string | null; rule: unknown; payload: { text?: unknown } };

on("schedule", async event => {
  // The key names this firing: a redelivered event returns the same call instead of reminding twice.
  const key = `${event.scheduleId}:${event.firedAt}`;
  await chrona.call("notify.send", { key, level: "now", title: "提醒", body: String(event.payload?.text ?? "") }, { mode: "async", key });
});

on("tool", async event => {
  const args = event.args as Record<string, string | undefined>;
  if (event.id === "create") {
    // Derived from the content: a retried create replaces the same timer instead of adding a second one.
    const key = `r-${createHash("sha256").update(JSON.stringify([args.rule, args.text, args.label])).digest("hex").slice(0, 24)}`;
    const created = await chrona.call("schedules.create", { key, rule: String(args.rule), payload: JSON.stringify({ text: String(args.text ?? "") }), label: String(args.label), ...(args.until ? { until: args.until } : {}) }) as Record<string, unknown> | null;
    return { result: { key, nextAt: created?.nextAt ?? null, status: created?.status ?? null } };
  }
  if (event.id === "list") {
    const timers = await chrona.call("schedules.mine", {}) as Timer[] | null;
    return { result: { reminders: (timers ?? []).map(timer => ({ key: timer.key, label: timer.label, text: String(timer.payload.text ?? ""), rule: timer.rule, status: timer.status, nextAt: timer.nextAt })) } };
  }
  if (event.id === "cancel") return { result: await chrona.call("schedules.cancel", { key: String(args.key) }) };
  throw new Error(`Unknown tool ${event.id}`);
});
