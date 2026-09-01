/** Browser-safe redaction primitives shared with the browser HTTP logger. */
export {
  REDACTED,
  redactSensitiveText,
  redactSensitiveValue,
  serializeSafeError,
  truncateSafeText,
  type RedactionOptions,
} from "../../../shared/http/redaction";
