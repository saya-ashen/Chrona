import { createHash } from "node:crypto";

import type { AiFeature } from "./types";

function sanitizeSessionPart(value: string, maxLength: number): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const trimmed = normalized.slice(0, maxLength).replace(/^-|-$/g, "");
  return trimmed || "default";
}

export function buildOpenClawSessionIdentity(feature: AiFeature, scope: string): {
  sessionId: string;
  sessionKey: string;
} {
  const sessionKey = scope.trim() || "default";
  const featurePart = sanitizeSessionPart(feature, 18);
  const scopePart = sanitizeSessionPart(sessionKey, 32);
  const scopeHash = createHash("sha1").update(sessionKey).digest("hex").slice(0, 12);
  return {
    sessionId: `ai-${featurePart}-${scopePart}-${scopeHash}`,
    sessionKey,
  };
}
