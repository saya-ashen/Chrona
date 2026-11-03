import { z } from "zod";
import * as outputs from "../system-outputs";
import { CallError, type SystemModule } from "../module-calls";
import { listActivity } from "../activity";
import { tool, text, json } from "./shared";

/** `activity` (v2-18): the user-facing audit trail in plain sentences, for the page and the owner's agents only. */
export const activity: SystemModule = {
  name: "activity",
  description: "活动记录：把内核的审计写成你能读的句子。",
  tools: [tool("list", "What Chrona did, newest first: approvals (created, reviewed, decided), module checks, activations, auto-updates, rollbacks and faults, grants, settings and credential changes (names only). module: one app; before: an earlier page.",
    { module: text("Module name"), before: text("ISO time from the previous page"), limit: { type: "number" } }, [], { idempotent: true, visibility: ["modules", "owner"], output: z.lazy(() => outputs.activityListOutput) })],
  async handle({ ports, workspaceId }, name, args) {
    if (name !== "list") throw new CallError("not_found", `activity.${name} not found`);
    return json(await listActivity(ports, workspaceId, { ...(args.module ? { module: String(args.module) } : {}), ...(args.before ? { before: String(args.before) } : {}), ...(args.limit ? { limit: Number(args.limit) } : {}) }));
  },
};
