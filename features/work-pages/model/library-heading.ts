import type { LibraryView } from "@chrona/contracts";
import type { LibraryLocation } from "./library-location";

export function libraryHeading(data: LibraryView | null, location: LibraryLocation, copy: { unclassified: string; all: string }) {
  const group = data?.groups.find(g => g.id === location.groupId);
  const folder = data?.folders.find(f => f.id === location.folderId);
  if (folder) return { group, folder, title: folder.name, count: folder.count };
  return {
    group,
    folder,
    title: location.unclassified ? copy.unclassified : group?.name ?? copy.all,
    count: location.unclassified ? group?.unclassifiedCount : data?.totalItems,
  };
}
