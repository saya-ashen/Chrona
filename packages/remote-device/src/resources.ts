import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { privateRoot } from "@chrona/workspaces";
import { bundledPlatform, bundledResources } from "./bundled-resources";
import { syncDirectory } from "./private-files";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function extractResources(root: string) {
  if (bundledPlatform !== `${process.platform}-${process.arch}` || !bundledResources.length) throw new Error("Run the standalone build for this Linux platform; bundled resources are missing");
  const directory = join(root, "resources"); privateRoot(directory);
  const paths: Record<string, string> = {};
  for (const resource of bundledResources) {
    if (!/^[a-z0-9.-]+$/.test(resource.name)) throw new Error("Invalid resource name");
    const bytes = Buffer.from(resource.base64, "base64");
    if (hash(bytes) !== resource.sha256) throw new Error("Bundled resource checksum mismatch");
    const path = join(directory, `${resource.sha256}-${resource.name}`);
    if (!lstatSync(path, { throwIfNoEntry: false })) {
      const temporary = `${path}.${randomUUID()}.next`, fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, resource.mode);
      try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, path); syncDirectory(directory);
    }
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== resource.mode || hash(readFileSync(fd)) !== resource.sha256) throw new Error("Extracted resource was changed");
    } finally { closeSync(fd); }
    paths[resource.name] = path;
  }
  return { helperPath: paths["chrona-process-guardian"]!, paths, platform: bundledPlatform };
}
