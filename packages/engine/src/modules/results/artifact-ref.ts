import { createHash } from "node:crypto";

/** Keep existing AF identity stable across managed and work-owned result paths. */
export function aiArtifactRef(artifactId: string): `AF${string}` {
  return `AF${createHash("sha256").update(artifactId).digest("hex").slice(0, 12).toUpperCase()}`;
}
