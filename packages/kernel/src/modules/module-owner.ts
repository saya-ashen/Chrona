import { moduleManifestSchema, secretNames, type ModuleManifest } from "@chrona/contracts/steward";
import { addsOAuthDefinitions } from "../secrets/oauth-definition";
import type { Prisma } from "@chrona/db";
import type { Caller } from "./module-call-types";
import type { StewardPorts } from "../ports";

/** Read the actual active, approved caller identity before applying an audience policy. */
export async function currentCallerManifest(db: StewardPorts["db"] | Prisma.TransactionClient, workspaceId: string, caller: Extract<Caller, { kind: "module" }>) {
  const module = await db.module.findFirst({
    where: { id: caller.moduleId, workspaceId, name: caller.module, status: "active", activeHash: caller.hash },
    select: { versions: { where: { hash: caller.hash, status: "approved" }, select: { manifest: true } } },
  });
  const manifest = moduleManifestSchema.safeParse(module?.versions[0]?.manifest).data;
  return manifest?.name === caller.module ? manifest : null;
}
/** Owner audience is granted only to the current approved owner-authority module identity. */
export async function isOwnerCaller(db: StewardPorts["db"] | Prisma.TransactionClient, workspaceId: string, caller: Caller): Promise<boolean> {
  if (caller.kind === "owner") return true;
  return caller.kind === "module" && (await currentCallerManifest(db, workspaceId, caller))?.authority === "owner";
}

/** Credential expansion and owner delegation require the same approval on every activation path. */
export function requiresCapabilityApproval(manifest: ModuleManifest, previous: ModuleManifest | null) {
  const had = previous ? secretNames(previous) : [];
  return secretNames(manifest).some(name => !had.includes(name)) || addsOAuthDefinitions(manifest, previous)
    || (manifest.authority === "owner" && previous?.authority !== "owner");
}
