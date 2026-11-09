import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import type { Caller, Tool, RoutedTool } from "./module-call-types";
import { isOwnerCaller } from "./module-owner";
import { isModulePaused } from "./module-availability";

/** Visibility defines the audience; `uses` is a contract, except `*` also reaches owner tools. */
export async function admitted(db: StewardPorts["db"] | Prisma.TransactionClient, caller: Caller, tool: RoutedTool, workspaceId: string) {
  if (caller.kind === "module" && isModulePaused(caller.module)) return false;
  const name = caller.kind === "module" || caller.kind === "system" ? caller.module : null;
  if (!name) return tool.visibility.includes(caller.kind as Tool["visibility"][number]);
  if (tool.visibility.includes("modules")) return true;
  if (caller.kind !== "module" || !tool.visibility.includes("owner")) return false;
  return isOwnerCaller(db, workspaceId, caller);
}
