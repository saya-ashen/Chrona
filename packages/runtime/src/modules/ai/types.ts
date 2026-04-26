/**
 * @deprecated Import plan/AI contracts from `@chrona/contracts/ai` directly in new code.
 *
 * Compatibility barrel kept during migration so legacy `@/modules/ai/types` imports
 * do not break while callsites are moved package-by-package.
 * TODO(chrona-refactor): remove this facade after all app/server imports target
 * `@chrona/contracts/ai`.
 */
export * from "@chrona/contracts/ai";
