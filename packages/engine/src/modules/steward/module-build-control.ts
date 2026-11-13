import { reviseBuildSchema } from "./module-build-inputs";
import type { StewardPorts } from "./ports";
import type { Caller } from "./module-call-types";
import { StewardError } from "./errors";
import { controlBuild, requestFiles } from "./module-build-session";

export async function buildControl(ports: StewardPorts, workspaceId: string, caller: Caller, name: string, args: Record<string, unknown>) {
  if (name === "stop-build") return controlBuild(ports, workspaceId, String(args.session));
  const input = reviseBuildSchema.parse(args);
  if (!input.files?.length) return controlBuild(ports, workspaceId, input.session, input.requirements);
  if (caller.kind !== "provider") throw new StewardError("forbidden", "Only the Provider may supply build reference files");
  const run = await ports.db.run.findFirst({ where: { id: caller.runId, workspaceId } });
  if (!run) throw new StewardError("not_found", "Run not found");
  return controlBuild(ports, workspaceId, input.session, input.requirements, await requestFiles(run.cwd, input.files));
}
