import { z } from "zod";
import * as outputs from "../system-outputs";
import { createSchedules } from "../schedules";
import { CallError, type SystemModule } from "../module-calls";
import { tool, text, entry, json, parsed } from "./shared";

/**
 * `schedules`: what is arranged for later (reminders, wakes, module schedules), for entry modules (v2-9);
 * `create`/`cancel`/`mine` are any module's own timers (v2-24).
 */
export const schedules: SystemModule = {
  name: "schedules",
  description: "日程：提醒、定时唤醒和应用的定时任务；应用也可以登记自己的定时。",
  tools: [
    tool("list", "Schedules of every status, newest created first.", {}, [], { idempotent: true, output: z.lazy(() => outputs.schedulesListOutput) }),
    tool("update", "Pause, resume or cancel a schedule.", { schedule: text(), status: { type: "string", enum: ["active", "paused", "cancelled"] } }, ["schedule", "status"], { idempotent: true, output: z.lazy(() => outputs.scheduleOutput) }),
    tool("create", "Arrange a timer of this module, named by key (letters, digits, . _ : -; at most 128): at the time this module receives a schedule event whose payload is the one given. Creating the same key again replaces it. rule: JSON {kind:at,at:ISO} | {kind:daily,time:HH:MM} | {kind:weekly,days:[0-6],time} | {kind:every,minutes>=5}, in the owner's timezone; payload: JSON object (at most 4000 characters); label: what the user sees on the schedule page. At most 500 timers per module.",
      { key: text(), rule: text(), payload: text(), label: text(), until: text() }, ["key", "rule", "payload", "label"], { idempotent: true, output: z.lazy(() => outputs.scheduleOutput) }),
    tool("cancel", "Cancel this module's timer with that key; { cancelled: false } when there is none.", { key: text() }, ["key"], { idempotent: true, output: z.lazy(() => outputs.scheduleCancelOutput) }),
    tool("mine", "This module's active and paused timers with their keys and payloads, soonest first.", {}, [], { idempotent: true, output: z.lazy(() => outputs.scheduleTimerOutput) }),
  ],
  async handle({ ports, workspaceId, caller }, name, args) {
    const module = entry(caller), store = createSchedules(ports, workspaceId);
    if (name === "list") return json(await store.list());
    if (name === "update") return json(await store.update(String(args.schedule), { status: args.status }));
    const own = store.forModule(module.moduleId, module.module);
    if (name === "create") return json(await own.create({ key: args.key, rule: parsed(args.rule, "rule"), payload: parsed(args.payload, "payload"), label: args.label, ...(args.until === undefined ? {} : { until: args.until }) }));
    if (name === "cancel") return json(await own.cancel(String(args.key)));
    if (name === "mine") return json(await own.list());
    throw new CallError("not_found", `schedules.${name} not found`);
  },
};
