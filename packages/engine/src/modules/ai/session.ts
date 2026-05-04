import { createHash } from "node:crypto";

import type { AiFeature } from "@chrona/contracts";

function sanitizeSessionPart(value: string, maxLength: number): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const trimmed = normalized.slice(0, maxLength).replace(/^-|-$/g, "");
  return trimmed || "default";
}

function timestampSessionPart(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

export function buildOpenClawSessionIdentity(feature: AiFeature, scope: string): {
  sessionId: string;
  sessionKey: string;
} {
  const sessionKey = scope.trim() || "default";
  const featurePart = sanitizeSessionPart(feature, 18);
  const scopePart = sanitizeSessionPart(sessionKey, 28);
  const scopeHash = createHash("sha1").update(sessionKey).digest("hex").slice(0, 10);
  return {
    sessionId: `ai-${featurePart}-${scopePart}-${timestampSessionPart()}-${scopeHash}`,
    sessionKey,
  };
}
