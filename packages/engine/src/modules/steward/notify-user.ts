import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { recordApprovalFact, recordKernelFact, recordWithdrawal, type LifecycleFact, type KernelFact } from "./notification-facts";
export type { LifecycleFact } from "./notification-facts";
export type UserNotice = Extract<KernelFact, { type: "notice" }>["data"];
type Db = StewardPorts["db"] | Prisma.TransactionClient;
/** Persist finite facts with state. Applications own presentation, budget and delivery. */
export function notifyUser(tx: Db, ports: StewardPorts, workspaceId: string, notice: UserNotice) {
  return recordKernelFact(tx, workspaceId, notice.key, { type: "notice", data: { ...notice, title: notice.title.slice(0, 200), body: notice.body.slice(0, 4000) } }, ports.now());
}
export function notifyLifecycle(tx: Db, ports: StewardPorts, workspaceId: string, key: string, fact: LifecycleFact & { module?: string; session?: string }) {
  const { module, session, ...value } = fact;
  return recordKernelFact(tx, workspaceId, key, { type: "lifecycle", data: { key, ...(module ? { module } : {}), ...(session ? { session } : {}), fact: value } }, ports.now());
}
export function withdrawNotice(tx: Db, ports: StewardPorts, workspaceId: string, key: string) {
  return recordWithdrawal(tx, workspaceId, key, ports.now());
}
/** Backfill preexisting open approvals; new approvals are recorded in their creation transaction. */
export async function announceApprovals(ports: StewardPorts, workspaceId: string) {
  for (const row of await ports.db.approval.findMany({ where: { workspaceId, status: "open" }, orderBy: { createdAt: "asc" } })) await recordApprovalFact(ports.db, row);
}
