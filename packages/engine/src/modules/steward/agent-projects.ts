import type { StewardPorts } from "./ports";
import type { CallOrigin } from "./module-call-types";
import { CallError } from "./module-call-error";
import { isOwnerCaller } from "./module-owner";
import { projectsInput, projectsOutput, projectPrincipal } from "@chrona/contracts/steward";

/** Only called with the original live routed call, never with callback-supplied project arguments. */
export async function admitAgentProjects(ports: StewardPorts, workspaceId: string, caller: CallOrigin["caller"], raw: Record<string, unknown>) {
  if (caller.kind !== "module" || !await isOwnerCaller(ports.db, workspaceId, caller)) throw new CallError("forbidden", "Host project management requires a current approved owner application");
  const parsed = projectsInput.safeParse(raw);
  if (!parsed.success) throw new CallError("invalid", "Invalid Agent projects arguments");
  const input = parsed.data;
  const principal = projectPrincipal.parse({ workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: caller.moduleId, hash: caller.hash } });
  const host = ports.executionProjects;
  if (!host) throw new CallError("unavailable", "Host project management unavailable");
  if (input.action === "list") return projectsOutput.parse({ action: input.action, principal, projects: (await host.list(principal)).projects });
  const project = input.action === "register" ? await host.register(principal, input.path!) : await host.create(principal, input.name!);
  return projectsOutput.parse({ action: input.action, principal, project });
}
