import { apiPage } from "../api-page";
import { publicSystemTools } from "./tool-contract-declarations";
import { APPROVAL_STATUSES } from "@chrona/contracts/steward";
import { createApprovals, isModuleRequest } from "../approvals";
import { createModules, isModuleApproval } from "../modules/modules";
import { AwaitUser, CallError, type Caller, type SystemModule } from "../modules/module-calls";
import type { StewardPorts } from "../ports";
import { entry, json, requireOwner } from "./shared";

/** `approvals`: owner decisions, plus each module's own requests. */
/** v2-16: one approval per async call (redeliveries find it); the call waits until the user decides. */
async function moduleRequest(ports: StewardPorts, workspaceId: string, module: Extract<Caller, { kind: "module" }>, call: { id: string; mode?: "sync" | "async" } | undefined, args: Record<string, unknown>) {
  if (!call || call.mode !== "async") throw new CallError("invalid", "approvals.request waits for the user: call it with mode async and reply: true");
  const rows = await ports.db.approval.findMany({ where: { workspaceId, moduleId: module.moduleId, action: "modify_external" }, orderBy: { createdAt: "desc" }, take: 200 });
  const existing = rows.find(row => isModuleRequest(row.payload) && row.payload.call === call.id);
  const approval = existing ?? await ports.db.approval.findUniqueOrThrow({ where: { id: (await createApprovals({ db: ports.db, workspaceId, now: ports.now }).create({
    action: "modify_external", moduleId: module.moduleId, title: `${module.module}：${String(args.title)}`.slice(0, 200),
    detail: String(args.detail ?? "").slice(0, 4000), preview: String(args.preview ?? "").slice(0, 20_000), payload: { kind: "module_request", hash: module.hash, call: call.id },
  })).id } });
  if (approval.status === "approved" || approval.status === "denied") return { approval: approval.id, decision: approval.status };
  if (approval.status !== "open") throw new CallError("failed", `Request ${approval.status}`);
  throw new AwaitUser({ approval: approval.id, status: "open" });
}
async function moduleRequestStatus(ports: StewardPorts, workspaceId: string, module: Extract<Caller, { kind: "module" }>, id: string) {
  const row = await ports.db.approval.findFirst({ where: { workspaceId, id, moduleId: module.moduleId } });
  if (!row || !isModuleRequest(row.payload)) throw new CallError("not_found", "Request not found");
  return { approval: row.id, status: row.status, hash: row.payload.hash, resolvedAt: row.resolvedAt?.toISOString() ?? null };
}
export const approvals: SystemModule = {
  name: "approvals",
  description: "审批：需要你决定的事，记录你的决定并将结果交回发起方。",
  tools: publicSystemTools.approvals,
  async handle({ ports, workspaceId, caller, call }, name, args) {
    if (name === "request") return moduleRequest(ports, workspaceId, entry(caller), call, args);
    if (name === "status") return moduleRequestStatus(ports, workspaceId, entry(caller), String(args.approval));
    const owner = await requireOwner(ports.db, workspaceId, caller);
    const modules = createModules(ports, workspaceId);
    const service = createApprovals({ db: ports.db, workspaceId, now: ports.now }, async action => {
      // Approved lifecycle actions use the same dispatcher regardless of the application that requested them.
      if (isModuleApproval(action.payload)) await modules.onApproved(action);
      else await ports.onApproved?.(action);
    }, ports);
    if (name === "list") return json(apiPage(await service.list((args.status as (typeof APPROVAL_STATUSES)[number] | undefined) ?? "open"), { cursor: args.cursor, limit: args.limit }, `approvals:${workspaceId}:${args.status ?? "open"}`, row => `${row.createdAt}:${row.id}`));
    const source = owner.kind === "owner" ? owner.via ?? "owner" : owner.module;
    if (name === "resolve") return json((await service.resolve(String(args.approval), { decision: args.decision, scope: "once" }, source)).approval);
    throw new CallError("not_found", `approvals.${name} not found`);
  },
};
