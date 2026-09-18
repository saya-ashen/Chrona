export function libraryLocation(params: URLSearchParams) {
  const groupId = params.get("group") ?? undefined, folderId = params.get("folder") ?? undefined;
  const unclassified = params.get("unclassified") === "1", query = params.get("q") ?? "";
  const raw = Number(params.get("offset") ?? 0), offset = Number.isInteger(raw) && raw >= 0 && raw <= 1000000 ? raw : 0;
  return { groupId, folderId, unclassified, query, offset, directory: !!groupId && !folderId && !unclassified && !query };
}
export type LibraryLocation = ReturnType<typeof libraryLocation>;
