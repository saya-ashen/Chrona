import { readFileSync } from "node:fs";
import { join } from "node:path";
import { moduleManifestSchema, type ModuleManifest } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { handleModuleCall } from "./module-effects";
import type { QqReplyItem } from "./builtin/qq/bot";

/**
 * Tests: an active `qq` module row with the real built-in manifest, and `call` as the module's socket would make it
 * (handleModuleCall: `uses`, recorded caller, routing). `pushed` reads the `qq.reply` calls Chrona queued for it.
 */
export async function qqEntry(ports: StewardPorts, workspaceId: string) {
  const manifest: ModuleManifest = moduleManifestSchema.parse(JSON.parse(readFileSync(join(import.meta.dirname, "builtin/qq/module.json"), "utf8")));
  const module = await ports.db.module.create({ data: { workspaceId, name: "qq", activeHash: "qq-test", builtin: true } });
  await ports.db.moduleVersion.create({ data: { moduleId: module.id, hash: "qq-test", manifest, source: "builtin", intent: {}, report: {}, status: "approved" } });
  const scope = { workspaceId, moduleId: module.id, hash: "qq-test", manifest };
  async function call(target: string, args: Record<string, unknown>) {
    const reply = await handleModuleCall(ports, scope, { id: "test", method: "call", params: { target, args: args as never, mode: "sync", reply: false } });
    if ("error" in reply) throw Object.assign(new Error(reply.error.message), { code: reply.error.code });
    return (reply.result as { output: unknown }).output;
  }
  async function pushed(): Promise<(QqReplyItem & { callId: string; caller: string })[]> {
    const rows = await ports.db.moduleInvocation.findMany({ where: { workspaceId, target: "qq", tool: "reply" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return rows.map(row => {
      const args = row.args as Record<string, string>;
      return { callId: row.id, caller: row.caller, messageId: args.message!, sessionId: args.session ?? null, text: args.text!, workspace: args.workspace!, inReplyTo: args["in-reply-to"] ?? null, attachments: JSON.parse(args.attachments ?? "[]") };
    });
  }
  return { module, call, pushed };
}
