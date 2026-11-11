import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import type { Caller, Tool, RoutedTool } from "./module-call-types";
import { currentCallerManifest } from "./module-owner";
import { isModulePaused } from "./module-availability";

/** One discovery operation may reuse its caller read; never retain this check across requests or use it to invoke tools. */
export async function discoveryAdmission(db: StewardPorts["db"] | Prisma.TransactionClient, caller: Caller, workspaceId: string) {
  if (caller.kind === "system") return (tool: RoutedTool) => tool.visibility.includes("modules");
  if (caller.kind !== "module") return (tool: RoutedTool) => tool.visibility.includes(caller.kind as Tool["visibility"][number]);
  const manifest = isModulePaused(caller.module) ? null : await currentCallerManifest(db, workspaceId, caller);
  return (tool: RoutedTool) => !!manifest && !isModulePaused(caller.module)
    && (tool.visibility.includes("modules") || tool.visibility.includes("owner") && manifest.authority === "owner");
}

/** Visibility defines the audience; `uses` declares dependencies; approved explicit authority may reach owner tools. */
export async function admitted(db: StewardPorts["db"] | Prisma.TransactionClient, caller: Caller, tool: RoutedTool, workspaceId: string) {
  return (await discoveryAdmission(db, caller, workspaceId))(tool);
}
