import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import type { Caller, Tool, RoutedTool } from "./module-call-types";
import { currentCallerManifest } from "./module-owner";
import { isModulePaused } from "./module-availability";

/** Visibility defines the audience; `uses` declares dependencies; approved explicit authority may reach owner tools. */
export async function admitted(db: StewardPorts["db"] | Prisma.TransactionClient, caller: Caller, tool: RoutedTool, workspaceId: string) {
  if (caller.kind === "module" && isModulePaused(caller.module)) return false;
  if (caller.kind === "system") return tool.visibility.includes("modules");
  if (caller.kind !== "module") return tool.visibility.includes(caller.kind as Tool["visibility"][number]);
  const manifest = await currentCallerManifest(db, workspaceId, caller);
  if (!manifest) return false;
  return tool.visibility.includes("modules") || tool.visibility.includes("owner") && manifest.authority === "owner";
}
