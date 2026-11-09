import { committedToolContract } from "./module-tool-contract";
import { chronaToolInputSchemas as schemas, RUN_LIMITS } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { authenticateRun } from "./runs";
import { callModuleTool, moduleToolCatalog } from "./module-tools";
import { registerWorkspaceModule } from "./local-workspace";
import { runtimeCall } from "./local-runtime";
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
import { contextRunTools, callContextTool } from "./agent-context-tools";

type Claim = Awaited<ReturnType<typeof authenticateRun>> & { index: number };
/** Internal build reports stay with the authorized build; apps read bounded build facts. */
async function reply(ports: StewardPorts, { run, workspaceId, session }: Claim, raw: unknown) {
  const input = parseInput(schemas.chrona_reply, raw);
  if (!session || session.source !== "build") throw new StewardError("forbidden", "Only build runs use chrona_reply");
  registerWorkspaceModule();
  const attachments = await Promise.all(input.files.map(path => runtimeCall<{ name: string; ref: string; mime: string; size: number }>(ports, workspaceId, "workspace-local.capture-file", { runId: run.id, path })));
  const message = await ports.db.$transaction(async tx => {
    const message = await tx.message.create({ data: { workspaceId, direction: "out", channel: "in_app", sessionId: session.id, text: input.text, attachments, at: ports.now() } });
    await audit(tx, { workspaceId, actor: "chrona", kind: "run_reply", subjectId: run.id, details: { messageId: message.id } });
    return message;
  });
  return { messageId: message.id };
}
/** No provider-supplied workspace IDs: all ownership comes from the capability. */
export function createTools(ports: StewardPorts) {
  const { db, now } = ports;
  /** `timeoutSeconds` (v2-13): how long the caller waits; tools that wait stop by then, and never past the run's deadline. */
  async function call(token: string, name: string, raw: unknown, { timeoutSeconds = 60 }: { timeoutSeconds?: number } = {}) {
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
    const deadline = Math.min(now().getTime() + timeoutSeconds * 1000, run.deadlineAt!.getTime());
    let ok = false;
    try {
      const context = await contextRunTools(ports, run);
      if (context) {
        const result = await callContextTool(ports, context, name, raw, deadline);
        ok = true; return result;
      }
      if (claim.session?.source !== "build") throw new StewardError("forbidden", "Provider tools require an application Agent context or build");
      if (name.startsWith("m_")) {
        const result = await callModuleTool(ports, { workspaceId, sessionId: run.sessionId, runId: run.id, deadline }, name, raw);
        ok = true; return result;
      }
      if (name !== "chrona_reply") throw new StewardError("invalid", "Unknown Chrona tool");
      const result = await reply(ports, claim, raw);
      ok = true; return result;
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
    const { run, session } = await authenticateRun(db, token, now());
    const context = await contextRunTools(ports, run);
    if (context) return context.catalog;
    if (session?.source !== "build") return [];
    return [{ name: "chrona_reply", inputSchema: committedToolContract("chrona_reply").input }, ...await moduleToolCatalog(ports, run)];
  }, call };
}
