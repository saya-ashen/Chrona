import type { StewardPorts } from "./ports";
import { lifecycleNotice } from "./applications/notify/lifecycle";
import { kernelFactSchema } from "./notification-facts";

export type Notice = { title: string; body: string; level: string; idempotencyKey: string; moduleId: string | null; sessionId: string | null; approvalId: string | null; recipient: string | null; caller: string; status: string };
/** Test-only presentation: application sends plus finite kernel facts, without a live notification app. */
export async function notices(db: StewardPorts["db"], filter: Partial<Notice> = {}) {
  const calls = await db.moduleInvocation.findMany({ where: { target: "notify", tool: "send" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const facts = await db.kernelFact.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const rows = [...calls.map(row => ({ ...row, raw: row.args as Record<string, unknown> })), ...facts.flatMap(row => {
    const fact = kernelFactSchema.parse(row.payload);
    if (fact.type !== "notice" && fact.type !== "lifecycle") return [];
    const raw = fact.type === "notice" ? { ...fact.data, title: "处理需要你的输入", body: `运行 ${fact.data.run} 正在等待输入，请打开会话查看并回答。`, level: "now" } : { ...fact.data, ...lifecycleNotice(fact.data.fact.kind, fact.data.fact) };
    return [{ id: row.id, createdAt: row.createdAt, raw, caller: "kernel", callerModuleId: null, status: !row.consumedAt ? "pending" : "consumed" }];
  })].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  return rows.map(row => {
    const args = row.raw as Record<string, string | undefined>;
    return { title: args.title!, body: args.body!, level: args.level!, caller: row.caller, status: row.status,
      idempotencyKey: row.callerModuleId ? `module:${row.callerModuleId}:${args.key}` : args.key!, moduleId: row.callerModuleId ?? args.module ?? null,
      sessionId: args.session ?? null, approvalId: args.approval ?? null, recipient: args.recipient ?? null } satisfies Notice;
  }).filter(notice => Object.entries(filter).every(([key, value]) => notice[key as keyof Notice] === value));
}
export async function notice(db: StewardPorts["db"], filter: Partial<Notice> = {}) {
  const first = (await notices(db, filter)).at(0);
  if (!first) throw new Error(`No notice matching ${JSON.stringify(filter)}`);
  return first;
}
