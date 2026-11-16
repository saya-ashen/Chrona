import { createHash } from "node:crypto";
import { RUN_LIMITS } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { authenticateRun } from "./execution/runs";
import { audit } from "./audit";
import { StewardError } from "./errors";
import { contextRunTools, callContextTool } from "./agent/agent-context-tools";

/** No provider-supplied workspace IDs: all ownership comes from the capability. */
export function createTools(ports: StewardPorts) {
  const { db, now } = ports;
  /** `timeoutSeconds` (v2-13): how long the caller waits; tools that wait stop by then, and never past the run's deadline. */
  async function call(token: string, name: string, raw: unknown, { timeoutSeconds = 60, key }: { timeoutSeconds?: number; key?: string } = {}) {
    const claim = await db.$transaction(async tx => {
      const auth = await authenticateRun(tx, token, now(), name);
      const calls = Array.isArray(auth.run.toolCalls) ? auth.run.toolCalls as Prisma.InputJsonObject[] : [];
      if (calls.length >= RUN_LIMITS.maxChronaToolCalls) {
        await audit(tx, { workspaceId: auth.workspaceId, actor: "chrona", kind: "tool_limit_rejected", subjectId: auth.run.id, details: { tool: name.slice(0, 200) } });
        return null;
      }
      const index = calls.length;
      calls.push({ tool: name.slice(0, 200), at: now().toISOString(), ok: false });
      await tx.run.update({ where: { id: auth.run.id }, data: { toolCalls: calls } });
      await audit(tx, { workspaceId: auth.workspaceId, actor: "chrona", kind: "tool_started", subjectId: auth.run.id, details: { tool: name.slice(0, 200), index } });
      return { ...auth, index };
    });
    if (!claim) throw new StewardError("forbidden", "Chrona tool call limit reached");
    const { workspaceId, run, index } = claim;
    const waitUntil = now().getTime() + timeoutSeconds * 1000;
    const deadline = run.deadlineAt ? Math.min(waitUntil, run.deadlineAt.getTime()) : waitUntil;
    let ok = false;
    try {
      const context = await contextRunTools(ports, run);
      if (context) {
        const result = await callContextTool(ports, context, name, raw, { deadline, key: `provider:${run.id}:${createHash("sha256").update(String(key ?? index)).digest("hex")}` });
        ok = true; return result;
      }
      throw new StewardError("forbidden", "Provider tools require an application Agent context");
    } finally {
      await db.$transaction(async tx => {
        const row = await tx.run.findUniqueOrThrow({ where: { id: run.id } }), calls = row.toolCalls as Prisma.InputJsonObject[];
        calls[index] = { ...calls[index], ok };
        await tx.run.update({ where: { id: run.id }, data: { toolCalls: calls } });
        await audit(tx, { workspaceId, actor: "chrona", kind: "tool_finished", subjectId: run.id, details: { tool: name.slice(0, 200), index, ok } });
      });
    }
  }
  return { catalog: async (token: string) => {
    const { run } = await authenticateRun(db, token, now());
    const context = await contextRunTools(ports, run);
    if (context) return context.catalog;
    return [];
  }, call };
}
