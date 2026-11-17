import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { contentRefSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import { StewardError } from "../errors";
import { readBoundedFile } from "../workspace-files";

/** Internal Run input read. moduleId is the kernel-written admission receipt's real caller. */
export async function readRunContent(ports: StewardPorts, workspaceId: string, moduleId: string, ref: string) {
  const parsed = contentRefSchema.parse(ref), slash = parsed.indexOf("/");
  const module = await ports.db.module.findFirst({ where: { id: moduleId, workspaceId, name: parsed.slice(0, slash) } });
  if (!module) throw new StewardError("forbidden", "Agent input content must belong to the originating module");
  const parent = await realpath(join(ports.dataDir, "platform", "content"));
  const root = join(parent, module.id);
  if (await realpath(root) !== root) throw new StewardError("forbidden", "Input content path was replaced");
  const full = await realpath(join(root, parsed.slice(slash + 1)));
  const rel = relative(root, full);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new StewardError("forbidden", "Input content must stay inside its application");
  return { bytes: await readBoundedFile(full), mime: Bun.file(full).type || "application/octet-stream" };
}
