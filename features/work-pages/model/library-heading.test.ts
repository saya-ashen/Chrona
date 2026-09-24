import { describe, expect, it } from "vitest";
import type { LibraryView } from "@chrona/contracts";
import { libraryHeading } from "./library-heading";
import { libraryLocation } from "./library-location";

const copy = { all: "All", unclassified: "Unclassified" };
const data: LibraryView = {
  revision: "library-v1:test:1", canOrganize: true, canConfigure: true, isOwner: true, writesEnabled: true,
  groups: [{ id: "g", name: "Topic", instructions: "", allowAgentFolders: true, folderCount: 1, classifiedCount: 3, unclassifiedCount: 0 }],
  folders: [{ id: "f", groupId: "g", name: "Empty folder", description: "", count: 0 }],
  totalItems: 3, items: [], total: 0, nextOffset: null, history: [],
};

describe("libraryHeading", () => {
  it.each([
    ["loading", null, "", "All", undefined],
    ["all", data, "", "All", 3],
    ["group", data, "group=g", "Topic", 3],
    ["zero-count folder", data, "group=g&folder=f", "Empty folder", 0],
    ["zero unclassified", data, "group=g&unclassified=1", "Unclassified", 0],
    ["missing group", data, "group=missing", "All", 3],
    ["missing unclassified group", data, "group=missing&unclassified=1", "Unclassified", undefined],
    ["missing folder", data, "group=g&folder=missing", "Topic", 3],
  ] as const)("preserves %s title and count", (_name, view, query, title, count) => {
    expect(libraryHeading(view, libraryLocation(new URLSearchParams(query)), copy)).toMatchObject({ title, count });
  });
});
