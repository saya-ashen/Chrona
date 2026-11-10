import { z } from "zod";
import type { StewardPorts } from "./ports";

/** Kernel-owned fixed targets; workspace files and audit history carry no authority. */
export async function declaredModules(db: Pick<StewardPorts["db"], "buildTargets">, workspaceId: string, sessionId: string): Promise<string[] | null> {
  const row = await db.buildTargets.findFirst({ where: { sessionId, session: { workspaceId } }, select: { name: true, modules: true } });
  const details = z.object({ name: z.string().min(1), modules: z.array(z.string().min(1)).min(1).max(4) }).safeParse(row);
  if (!details.success) return null;
  const { name, modules } = details.data;
  return new Set(modules).size === modules.length && modules[0] === name ? modules : null;
}
