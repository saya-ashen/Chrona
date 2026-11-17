import type { StewardPorts } from "../ports";
import { kernelFactSchema, type LifecycleFact } from "../notification-facts";

type Notice = { title: string; body: string; level: string; kind: string | null; fact: LifecycleFact | null; idempotencyKey: string; moduleId: string | null; sessionId: string | null; approvalId: string | null; recipient: string | null; caller: string; status: string };
export async function notices(db: StewardPorts["db"], filter: Partial<Notice> = {}) {
  const calls = await db.moduleInvocation.findMany({ where: { target: "notify", tool: "send" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const facts = await db.kernelFact.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const sent: Notice[] = calls.map(row => {
    const args = row.args as Record<string, string | undefined>;
    return { title: args.title!, body: args.body!, level: args.level!, kind: null, fact: null, caller: row.caller, status: row.status,
      idempotencyKey: row.callerModuleId ? `module:${row.callerModuleId}:${args.key}` : args.key!, moduleId: row.callerModuleId ?? args.module ?? null,
      sessionId: args.session ?? null, approvalId: args.approval ?? null, recipient: args.recipient ?? null };
  });
  const recorded = facts.flatMap(row => {
    const fact = kernelFactSchema.parse(row.payload);
    if (fact.type !== "notice" && fact.type !== "lifecycle") return [];
    return [{ title: "", body: "", level: "", kind: fact.type === "notice" ? fact.data.kind : fact.data.fact.kind,
      fact: fact.type === "lifecycle" ? fact.data.fact : null, idempotencyKey: fact.data.key,
      moduleId: fact.type === "lifecycle" ? fact.data.module ?? null : null, sessionId: fact.data.session ?? null,
      approvalId: null, recipient: null, caller: "kernel", status: row.consumedAt ? "consumed" : "pending" } satisfies Notice];
  });
  return [...sent, ...recorded].filter(notice => Object.entries(filter).every(([key, value]) => notice[key as keyof Notice] === value));
}
export async function notice(db: StewardPorts["db"], filter: Partial<Notice> = {}) {
  const first = (await notices(db, filter)).at(0);
  if (!first) throw new Error(`No notice matching ${JSON.stringify(filter)}`);
  return first;
}
