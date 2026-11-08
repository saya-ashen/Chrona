import { redactSensitiveText } from "@chrona/logging/redaction";

const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max)}…（已截断）` : text;
/** Redaction is a kernel boundary, independent of the selected Provider. Always redact before clipping. */
export function transcriptRedactor() {
  const values = Object.entries(process.env).filter(([key, value]) => /(KEY|TOKEN|SECRET|PASSWORD)/i.test(key) && value && value.length >= 8).map(([, value]) => value!);
  return (text: string, limit: number) => clip(redactSensitiveText(values.reduce((out, value) => out.replaceAll(value, "[redacted]"), text).replace(/\bxox[abp]-[A-Za-z0-9_-]{16,}/g, "[redacted]"), Number.MAX_SAFE_INTEGER), limit);
}
