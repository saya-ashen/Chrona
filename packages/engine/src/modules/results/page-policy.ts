export function contentHasPage(content: unknown): boolean {
  // Both presentation and its private feedback linkage require page authority.
  return Boolean(content && typeof content === "object" && !Array.isArray(content) && (("page" in content && content.page) || ("continuation" in content && content.continuation)));
}
export function pageWritesEnabled() { return process.env.CHRONA_WORK_PAGES_WRITES_ENABLED === "true"; }
export function workPageCapabilities(scopes: readonly string[]) {
  const canRead = ["tasks:read", "results:read", "pages:read"].every((s) => scopes.includes(s));
  return { stage: "work_pages_v1", canRead, canValidate: canRead && scopes.includes("pages:write"),
    canPublish: canRead && scopes.includes("pages:write") && scopes.includes("results:write") && pageWritesEnabled() && process.env.CHRONA_RESULT_WRITES_ENABLED === "true",
    canSubmitUserResponses: false, writesEnabled: pageWritesEnabled(), arbitraryHtml: false, privilegedActions: false,
    continuation: { canRead: canRead, canReport: canRead && scopes.includes("pages:write") && scopes.includes("results:write") && pageWritesEnabled() && process.env.CHRONA_RESULT_WRITES_ENABLED === "true", automaticWake: false, snapshotReads: true, reportsAreClaims: true },
    catalogVersion: 1, maxElements: 128, maxDepth: 12, maxForms: 8, maxFieldsPerForm: 30, maxEntriesPerResult: 2000 };
}
