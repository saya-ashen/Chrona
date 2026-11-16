/** Credential redaction for text sent to logs. */
export const REDACTED = "[Redacted]";

const MAX_STRING_LENGTH = 400;
const SENSITIVE_QUERY_KEY = /^(?:api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|token|password|secret|authorization|auth|key|signature|sig)$/i;

export function truncateSafeText(value: string, maxLength = MAX_STRING_LENGTH): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…(${value.length - maxLength} more chars)` : value;
}

function redactUrl(value: string): string {
  return value.replace(/\bhttps?:\/\/[^\s"']+/gi, (candidate) => {
    try {
      const url = new URL(candidate);
      let changed = false;
      if (url.username || url.password) {
        url.username = "";
        url.password = "";
        changed = true;
      }
      for (const key of [...url.searchParams.keys()]) {
        if (SENSITIVE_QUERY_KEY.test(key)) {
          url.searchParams.set(key, REDACTED);
          changed = true;
        }
      }
      return changed ? url.toString() : candidate;
    } catch {
      return candidate;
    }
  });
}

/** Browser- and server-safe credential redaction for text sent to logs. */
export function redactSensitiveText(value: string, maxLength = MAX_STRING_LENGTH): string {
  const redacted = redactUrl(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, `Bearer ${REDACTED}`)
    .replace(/(?:\b|["'])(?:api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|client[\s_-]?(?:secret|token|key)|token|password|passphrase|secret|authorization)(?:\b|["'])\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, (_match, separator: string) => `credential${separator}${REDACTED}`)
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|sk-ant-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{12,})\b/g, REDACTED);
  return truncateSafeText(redacted, maxLength);
}

