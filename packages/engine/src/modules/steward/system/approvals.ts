import { z } from "zod";
import * as outputs from "../system-outputs";
import { APPROVAL_SCOPES, APPROVAL_STATUSES } from "@chrona/contracts/steward";
import { createApprovals, isModuleRequest } from "../approvals";
import { createModules, isModuleApproval } from "../modules";
import { AwaitUser, CallError, type Caller, type SystemModule } from "../module-calls";
import type { StewardPorts } from "../ports";
import { tool, text, entry, json } from "./shared";

/** `approvals`: the user's decisions, for entry modules (QQ buttons and text commands). */
/** v2-16: one approval per async call (redeliveries find it); the call waits until the user decides. */
async function moduleRequest(ports: StewardPorts, workspaceId: string, module: Extract<Caller, { kind: "module" }>, call: { id: string } | undefined, args: Record<string, unknown>) {
  if (!call) throw new CallError("invalid", "approvals.request waits for the user: call it with mode async and reply: true");
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
  description: "审批：需要你决定的事，先分级并经 AI 复核，结果交回发起方。",
  tools: [
    tool("list", "Approvals, by status (default open).", { status: { type: "string", enum: [...APPROVAL_STATUSES] } }, [], { idempotent: true, output: z.lazy(() => outputs.approvalsListOutput) }),
    tool("resolve", "Approve or deny an approval as the user (only after the user decided).", { approval: text(), decision: { type: "string", enum: ["approve", "deny"] }, scope: { type: "string", enum: [...APPROVAL_SCOPES] } }, ["approval", "decision"], { output: z.lazy(() => outputs.approvalOutput) }),
    tool("request", "Ask the user to decide something this module is about to do (v2-16). Call asynchronously with reply: the call waits, and its call_result carries { approval, decision: approved | denied }. Approved once, never standing.",
      { title: text("What the user decides, e.g. 开始模拟实验"), detail: text("Why, and what follows"), preview: text("Exactly what will be done") }, ["title"], { idempotent: true, output: z.lazy(() => outputs.approvalRequestOutput) }),
    tool("status", "A request this module made: { status, hash, resolvedAt }.", { approval: text() }, ["approval"], { idempotent: true, output: z.lazy(() => outputs.approvalStatusOutput) }),
  ],
  async handle({ ports, workspaceId, caller, call }, name, args) {
    const module = entry(caller), modules = createModules(ports, workspaceId);
    if (name === "request") return moduleRequest(ports, workspaceId, module, call, args);
    if (name === "status") return moduleRequestStatus(ports, workspaceId, module, String(args.approval));
    const service = createApprovals({ db: ports.db, workspaceId, now: ports.now }, async action => {
      // Same routing as the service: pause/resume and removal approved in chat (QQ, MCP) must take effect too.
      if (isModuleApproval(action.payload)) await modules.onApproved(action);
      else await ports.onApproved?.(action);
    }, ports);
    if (name === "list") return json(await service.list((args.status as (typeof APPROVAL_STATUSES)[number] | undefined) ?? "open"));
    const source = module.module;
    if (name === "resolve") return json((await service.resolve(String(args.approval), { decision: args.decision, scope: args.scope ?? "once" }, source)).approval);
    throw new CallError("not_found", `approvals.${name} not found`);
  },
};
