import type { StewardPorts } from "./ports";
import { lifecycleNotice } from "./builtin/notify/lifecycle";

export type Notice = { title: string; body: string; level: string; idempotencyKey: string; moduleId: string | null; sessionId: string | null; approvalId: string | null; recipient: string | null; caller: string; status: string };
/** Tests: the notices queued for notify.send (by Chrona or by modules), as the notify module will store them. */
export async function notices(db: StewardPorts["db"], filter: Partial<Notice> = {}) {
  const rows = await db.moduleInvocation.findMany({ where: { target: "notify", tool: { in: ["send", "lifecycle"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return rows.map(row => {
    const raw = row.args as Record<string, string | undefined>;
    const args = row.tool === "lifecycle" ? { ...raw, ...lifecycleNotice(raw.kind!, JSON.parse(raw.facts!)) } : raw;
    return { title: args.title!, body: args.body!, level: args.level!, caller: row.caller, status: row.status,
      // Same key and app the notify module derives: a module's keys are namespaced by its id.
      idempotencyKey: row.callerModuleId ? `module:${row.callerModuleId}:${args.key}` : args.key!, moduleId: row.callerModuleId ?? args.module ?? null,
      sessionId: args.session ?? null, approvalId: args.approval ?? null, recipient: args.recipient ?? null } satisfies Notice;
  }).filter(notice => Object.entries(filter).every(([key, value]) => notice[key as keyof Notice] === value));
}
export async function notice(db: StewardPorts["db"], filter: Partial<Notice> = {}) {
  const first = (await notices(db, filter)).at(0);
  if (!first) throw new Error(`No notice matching ${JSON.stringify(filter)}`);
  return first;
}
