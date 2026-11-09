import { z } from "zod";
import type { StewardPorts } from "./ports";

/** What the build conversation was asked to change, recorded by the kernel when it was admitted (never read from its directory). */
export async function declaredModules(db: Pick<StewardPorts["db"], "audit">, workspaceId: string, sessionId: string): Promise<string[] | null> {
  const fixed = await db.audit.findUnique({ where: { id: `build-targets:${sessionId}` } });
  if (fixed && (fixed.workspaceId !== workspaceId || fixed.kind !== "build_targets" || fixed.subjectId !== sessionId)) return null;
  const row = fixed ?? await db.audit.findFirst({ where: { workspaceId, kind: "build_request", subjectId: sessionId } });
  const details = z.object({ name: z.string().min(1), modules: z.array(z.string().min(1)).min(1).max(4).optional() }).safeParse(row?.details);
  if (!details.success) return null;
  const targets = details.data.modules ?? [details.data.name];
  return new Set(targets).size === targets.length && targets[0] === details.data.name ? targets : null;
}

