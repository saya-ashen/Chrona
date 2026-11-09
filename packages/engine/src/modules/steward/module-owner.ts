import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { Prisma } from "@chrona/db";
import type { Caller } from "./module-call-types";
import type { StewardPorts } from "./ports";

/** Owner audience is granted only to the current approved wildcard module identity. */
export async function isOwnerCaller(db: StewardPorts["db"] | Prisma.TransactionClient, workspaceId: string, caller: Caller): Promise<boolean> {
  if (caller.kind === "owner") return true;
  if (caller.kind !== "module") return false;
  const module = await db.module.findFirst({
    where: { id: caller.moduleId, workspaceId, name: caller.module, status: "active", activeHash: caller.hash },
    select: { versions: { where: { hash: caller.hash, status: "approved" }, select: { manifest: true } } },
  });
  const manifest = moduleManifestSchema.safeParse(module?.versions[0]?.manifest).data;
  return manifest?.name === caller.module && manifest.uses.includes("*");
}
