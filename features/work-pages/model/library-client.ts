import type { LibraryRead, LibraryView, LibraryWrite, LibraryWriteResult } from "@chrona/contracts";
import { apiJson } from "@shared/http";
export const LIBRARY_CHANGED = "chrona:library-changed";
export const readLibrary = (input: Partial<LibraryRead>, signal?: AbortSignal) => apiJson<LibraryView>("/api/library/read", { method: "POST", body: JSON.stringify(input), signal });
export const writeLibrary = (input: LibraryWrite) => apiJson<LibraryWriteResult>("/api/library/update", { method: "POST", body: JSON.stringify(input) });
export function libraryHref(groupId?: string, folderId?: string, unclassified = false) {
  const p = new URLSearchParams();
  if (groupId) p.set("group", groupId);
  if (folderId) p.set("folder", folderId);
  if (unclassified) p.set("unclassified", "1");
  return `/home${p.size ? `?${p}` : ""}`;
}
