import { z } from "zod";
import * as outputs from "../system-outputs";
import { CallError, type SystemModule } from "../module-calls";
import { runtimeHealth } from "../runtime-health";
import { createProviderControl } from "../provider-channel";
import { activityRecords, activityRecordsOutput, listActivity } from "../activity";
import { tool, text, json } from "./shared";

/** Governed audit facts plus compatibility forwarding to notify's activity presentation. */
export const activity: SystemModule = {
  name: "activity",
  description: "活动记录：提供受控审计事实，展示由通知应用组织。",
  tools: [tool("runtime", "Runtime health facts without application presentation.", {}, [], { idempotent: true, visibility: ["modules", "owner"], output: z.lazy(() => outputs.chatRuntimeOutput) }), tool("runs", "Bounded execution status, progress, usage and pending interactions. Read-only runtime facts; no transcript or execution authority.", { session: text("Optional exact session id") }, [], { idempotent: true, visibility: ["modules", "owner"], output: z.lazy(() => outputs.chatRunsOutput) }),
    tool("list", "What Chrona did, newest first: approvals (created, reviewed, decided), module checks, activations, auto-updates, rollbacks and faults, grants, settings and credential changes (names only). module: one app; before: an earlier page.",
    { module: text("Module name"), before: text("ISO time from the previous page"), limit: { type: "number" } }, [], { idempotent: true, visibility: ["modules", "owner"], output: z.lazy(() => outputs.activityListOutput) }),
    tool("records", "Bounded workspace audit facts, newest first. Only allowlisted metadata; never raw details or credential values.",
      { before: text("ISO time from the previous page") }, [], { idempotent: true, visibility: ["modules", "owner"], output: activityRecordsOutput })],
  async handle({ ports, workspaceId, deadline, run }, name, args) {
    if (name === "runtime") return json(await runtimeHealth(ports, workspaceId));
    if (name === "runs") return json(await createProviderControl(ports, workspaceId).list(args.session === undefined ? undefined : String(args.session)));
    if (name === "records") return json(await activityRecords(ports, workspaceId, { ...(args.before ? { before: String(args.before) } : {}) }));
    if (name !== "list") throw new CallError("not_found", `activity.${name} not found`);
    return json(await listActivity(ports, workspaceId, { ...(args.module ? { module: String(args.module) } : {}), ...(args.before ? { before: String(args.before) } : {}), ...(args.limit ? { limit: Number(args.limit) } : {}) }, { deadline, run }));
  },
};
