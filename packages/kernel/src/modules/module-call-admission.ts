import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "../ports";
import type { Caller, Tool, RoutedTool } from "./module-call-types";
import { currentCallerManifest } from "./module-owner";

export function canDelegateTool(moduleName: string, toolName: string) {
  return moduleName !== "secrets" || ["list", "set", "remove"].includes(toolName);
}

/** One discovery operation may reuse its caller read; never retain this check across requests or use it to invoke tools. */
export async function discoveryAdmission(db: StewardPorts["db"] | Prisma.TransactionClient, caller: Caller, workspaceId: string) {
  if (caller.kind === "system") return (tool: RoutedTool) => tool.visibility.includes("modules");
  if (caller.kind !== "module") return (tool: RoutedTool) => tool.visibility.includes(caller.kind as Tool["visibility"][number]);
  const manifest = await currentCallerManifest(db, workspaceId, caller);
  return (tool: RoutedTool) => !!manifest
    && (tool.visibility.includes("modules") || tool.visibility.includes("owner") && manifest.authority === "owner");
}

/** Visibility defines the audience; `uses` declares dependencies; approved explicit authority may reach owner tools. */
export async function admitted(db: StewardPorts["db"] | Prisma.TransactionClient, caller: Caller, tool: RoutedTool, workspaceId: string, target?: { id: string; name: string }) {
  if (!(await discoveryAdmission(db, caller, workspaceId))(tool)) return false;
  if (caller.kind !== "module" || !target || target.id === caller.moduleId || target.id.startsWith("system:") || target.id.startsWith("local:")) return true;
  const provider = await db.agentProvider.findFirst({ where: { workspaceId, moduleId: caller.moduleId }, select: { id: true } });
  if (!provider) return true;
  return target.name === "web" && tool.name === "page-set" && !!(await currentCallerManifest(db, workspaceId, caller))?.uses.includes("web.page-set");
}
