import type { StewardPorts } from "./ports";
import { runtimeCall } from "./local-runtime";
import { registerContentModule } from "./local-content";
import { CONTENT_READ_MAX_BYTES } from "./local-content-reference";
export { CONTENT_READ_MAX_BYTES } from "./local-content-reference";

/** Kernel callers provide the authenticated workspace; local paths stay inside the content module. */
export async function readContentRef(ports: StewardPorts, workspaceId: string, ref: string, maxBytes = CONTENT_READ_MAX_BYTES) {
  registerContentModule();
  const { base64, ...file } = await runtimeCall<{ ref: string; name: string; mime: string; sha256: string; base64: string }>(ports, workspaceId, "content-local.reference", { ref, maxBytes });
  return { ...file, bytes: Buffer.from(base64, "base64") };
}
