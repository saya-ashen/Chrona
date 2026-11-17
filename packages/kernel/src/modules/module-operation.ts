import { Prisma } from "@chrona/db";
import { lifecycleOperationSchema } from "@chrona/contracts/steward";
import { createModules } from "./modules";
import type { SystemModule } from "./module-system-types";
import type { StewardPorts } from "../ports";
import { CallError, publicCallError } from "./module-call-error";
import { StewardError } from "../errors";
import { callerKey } from "./module-calls";
import { approvedOperationOutput } from "./module-operation-result";

type Context = Pick<Parameters<SystemModule["handle"]>[0], "ports" | "workspaceId" | "caller" | "call">;
type Invocation = Prisma.ModuleInvocationGetPayload<object>;
type Operation = ReturnType<typeof lifecycleOperationSchema.parse>;
const actions = ["enable", "disable", "rollback", "remove"];

/** The routed call's output is the immutable submission receipt; operation queries derive their own view. */
export async function moduleOperation({ ports, workspaceId, caller, call }: Context, name: string, args: Record<string, unknown>) {
  if (name === "operation") return queryOperation({ ports, workspaceId, caller }, args);
  if (!call?.key) throw new CallError("invalid", "Lifecycle operations require a call key");
  const identity = { operationId: call.id, moduleId: String(args.moduleId) };
  try {
    const result = await createModules(ports, workspaceId).lifecycle(name, identity.moduleId, args, true);
    return lifecycleOperationSchema.parse({ ...identity, status: result.status === "pending_approval" ? "pending_approval" : "done", ...("approvalId" in result ? { approvalId: result.approvalId } : {}), result });
  } catch (cause) {
    const known = cause instanceof CallError || cause instanceof StewardError;
    const code = known ? publicCallError(cause.code) : "unknown";
    return lifecycleOperationSchema.parse({ ...identity, status: known && code !== "unknown" ? "failed" : "unknown", error: { code, message: known ? cause.message : "Operation result requires reconciliation" } });
  }
}

async function queryOperation({ ports, workspaceId, caller }: Context, args: Record<string, unknown>) {
  const row = await ports.db.moduleInvocation.findFirst({ where: {
    workspaceId, targetIdentity: "system:modules", tool: { in: actions }, mode: { in: ["sync", "async"] },
    ...(args.operationId ? { id: String(args.operationId) } : { caller: callerKey(caller), tool: String(args.action), key: String(args.key) }),
  } });
  if (!row || !args.operationId && (row.args as { moduleId?: unknown }).moduleId !== args.moduleId) throw new CallError("not_found", "Operation not found");
  return reconcile(ports, row);
}

async function reconcileApproval(ports: StewardPorts, row: Invocation, output: Operation): Promise<Operation> {
  const approval = await ports.db.approval.findFirst({ where: { id: output.approvalId, workspaceId: row.workspaceId } });
  const identity = { operationId: row.id, moduleId: (row.args as { moduleId: string }).moduleId, approvalId: output.approvalId };
  if (!approval) return { ...identity, status: "unknown", error: { code: "unknown", message: "Operation approval evidence is missing" } };
  if (approval.status === "denied" || approval.status === "expired") return { ...identity, status: "failed", error: { code: "failed", message: "Operation approval was denied or expired" } };
  if (approval.status === "approved") return approvedOperationOutput(ports.db, row, output.approvalId);
  return output;
}

async function reconcile(ports: StewardPorts, row: Invocation) {
  const moduleId = (row.args as { moduleId: string }).moduleId;
  if (row.operationOutput) return lifecycleOperationSchema.parse(row.operationOutput);
  let output = row.output ? lifecycleOperationSchema.parse(row.output) : lifecycleOperationSchema.parse({ operationId: row.id, moduleId, status: "unknown" });
  if (output.status !== "pending_approval" && !((output.status === "running" || output.status === "unknown") && output.approvalId)) return output;
  output = await reconcileApproval(ports, row, output);
  // Cache only definite terminal evidence, separately from the original submission receipt.
  if (output.status === "done" || output.status === "failed") {
    await ports.db.moduleInvocation.updateMany({ where: { id: row.id, operationOutput: { equals: Prisma.DbNull } }, data: { operationOutput: output } });
    const current = await ports.db.moduleInvocation.findUniqueOrThrow({ where: { id: row.id } });
    return lifecycleOperationSchema.parse(current.operationOutput);
  }
  return output;
}
