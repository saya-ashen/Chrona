import { z } from "zod";
import { CallError, type SystemModule } from "../module-calls";
import { resolveExecutionPrincipal } from "../execution-principal";
import { callerManifest, json, text, tool } from "./shared";

const project = z.object({ projectRef: z.string().min(1), path: z.string().min(1), label: z.string().min(1) }).strict();
/** Registering arbitrary host paths is an explicitly declared module capability, never a Provider tool. */
export const projects: SystemModule = {
  name: "projects", description: "Authorized local project directories.",
  tools: [
    tool("list", "List this caller's registered project directories", {}, [], { visibility: ["owner", "modules"], idempotent: true, output: z.object({ projects: z.array(project).max(100) }).strict() }),
    tool("register", "Authorize an existing local directory for this caller", { path: text("Absolute host directory path") }, ["path"], { visibility: ["owner", "modules"], idempotent: true, input: z.object({ path: z.string().trim().min(1).max(4096) }).strict(), output: project }),
    tool("create", "Create a caller-scoped project under the host-managed root", { name: text("Safe logical project name, not a host path") }, ["name"], { visibility: ["owner", "modules"], idempotent: true, input: z.object({ name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/) }).strict(), output: project }),
  ],
  async handle({ ports, workspaceId, caller }, name, args) {
    if (caller.kind === "module") {
      const manifest = await callerManifest(ports.db, caller);
      if (!manifest?.uses.includes(`projects.${name}`) && !manifest?.uses.includes("*")) throw new CallError("forbidden", "Project directory management must be explicitly declared by this module");
    }
    const principal = await resolveExecutionPrincipal(ports, workspaceId, caller);
    if (!ports.executionProjects) throw new CallError("unavailable", "Local project registration is unavailable");
    if (name === "list") return json(await ports.executionProjects.list(principal));
    if (name === "register") return json(await ports.executionProjects.register(principal, args.path as string));
    if (name === "create") return json(await ports.executionProjects.create(principal, args.name as string));
    throw new CallError("not_found", "Project tool not found");
  },
};
