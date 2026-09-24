import type { LibraryView } from "@chrona/contracts";
import type { LibraryLocation } from "./library-location";

export function libraryHeading(data: LibraryView | null, location: LibraryLocation, copy: { unclassified: string; all: string }) {
  const group = data?.groups.find(g => g.id === location.groupId);
  const folder = data?.folders.find(f => f.id === location.folderId);
  return {
    group,
    folder,
    title: folder?.name ?? (location.unclassified ? copy.unclassified : group?.name ?? copy.all),
    count: folder?.count ?? (location.unclassified ? group?.unclassifiedCount : data?.totalItems),
  };
}
