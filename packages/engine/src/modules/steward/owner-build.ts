import { createHash } from "node:crypto";
import { z } from "zod";
import { isEntryModule, moduleManifestSchema } from "@chrona/contracts/steward";
import { buildIntentSchema, reviseBuildSchema } from "./module-build-inputs";
import type { StewardPorts } from "./ports";
import { StewardError } from "./errors";
import { buildSettings } from "./settings";
import { controlBuild, queueBuild, requestFiles } from "./module-build-session";
import type { Caller } from "./module-call-types";

import { assertBuildProvider, buildExecutionSchema } from "./build-execution";
export const ownerBuildSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  goal: z.string().min(1).max(4000),
  intent: buildIntentSchema,
  requestKey: z.string().min(1).max(200),
  execution: buildExecutionSchema,
}).strict();
export async function buildControl(ports: StewardPorts, workspaceId: string, caller: Caller, name: string, args: Record<string, unknown>) {
  if (name === "stop-build") return controlBuild(ports, workspaceId, String(args.session));
  const input = reviseBuildSchema.parse(args);
  if (!input.files?.length) return controlBuild(ports, workspaceId, input.session, input.requirements);
  if (caller.kind !== "provider") throw new StewardError("forbidden", "Only the Provider may supply build reference files");
  const run = await ports.db.run.findFirst({ where: { id: caller.runId, workspaceId } });
  if (!run) throw new StewardError("not_found", "Run not found");
  return controlBuild(ports, workspaceId, input.session, input.requirements, await requestFiles(run.cwd, input.files));
}

export async function startOwnerBuildAsCaller(ports: StewardPorts, workspaceId: string, caller: Caller, raw: unknown) {
  if (caller.kind !== "owner") {
    const version = caller.kind === "module" ? await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: caller.moduleId, hash: caller.hash } } }) : null;
    const manifest = moduleManifestSchema.safeParse(version?.manifest).data;
    if (!manifest || !isEntryModule(manifest)) throw new StewardError("forbidden", "Only the owner entry may start a bounded build");
  }
  return startOwnerBuild(ports, workspaceId, raw);
}

export async function startOwnerBuild(ports: StewardPorts, workspaceId: string, raw: unknown) {
  const input = ownerBuildSchema.parse(raw);
  await assertBuildProvider(ports, workspaceId, input.execution);
  const limits = buildSettings((await ports.db.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings);
  if (input.execution.timeoutMinutes > limits.timeoutMinutes || input.execution.maxSubmissions > limits.maxSubmissions) throw new StewardError("conflict", "Build limits cannot exceed the owner's configured caps");
  const key = `owner-build:${createHash("sha256").update(JSON.stringify([workspaceId, input.requestKey])).digest("hex")}`;
  const request = { name: input.name, goal: input.goal, intent: input.intent, examples: [], files: [] };
  return queueBuild(ports, workspaceId, { key, actorKey: "user", originSessionId: null, request, execution: input.execution });
}
