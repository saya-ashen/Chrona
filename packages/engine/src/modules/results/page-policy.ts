export function contentHasPage(content: unknown): boolean {
  return Boolean(content && typeof content === "object" && !Array.isArray(content) && "page" in content && content.page);
}
export function pageWritesEnabled() { return process.env.CHRONA_WORK_PAGES_WRITES_ENABLED === "true"; }
export function workPageCapabilities(scopes: readonly string[]) {
  const canRead = ["tasks:read", "results:read", "pages:read"].every((s) => scopes.includes(s));
  return { stage: "work_pages_v1", canRead, canValidate: canRead && scopes.includes("pages:write"),
    canPublish: canRead && scopes.includes("pages:write") && scopes.includes("results:write") && pageWritesEnabled() && process.env.CHRONA_RESULT_WRITES_ENABLED === "true",
    canSubmitUserResponses: false, writesEnabled: pageWritesEnabled(), arbitraryHtml: false, privilegedActions: false,
    catalogVersion: 1, maxElements: 128, maxDepth: 12, maxForms: 8, maxFieldsPerForm: 30, maxEntriesPerResult: 2000 };
}
