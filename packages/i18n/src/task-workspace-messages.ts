export const taskWorkspaceActivityMessages = {
  taskTitle: "Execution activity",
  taskEmpty: "Activity will appear after planning or execution starts.",
  nodeTitle: "Node activity",
  nodeEmpty: "Activity tied to this node will appear after planning or execution starts.",
  reasoningDetails: "Reasoning details",
  showToolDetails: "Show tool details",
  hideToolDetails: "Hide tool details",
  showFullContent: "Show full content",
  hideFullContent: "Hide full content",
  loadOlder: "Load older activity",
  loadingOlder: "Loading older activity...",
  feedStats: ({ shown, live, saved }: { shown: number; live: number; saved: number }) =>
    `${shown} shown · ${live} live · ${saved} saved`,
  emptyHint: "Runtime events and saved history will appear here.",
  toolLabels: {
    tool: "Tool",
    input: "Input",
    preview: "Preview",
    duration: "Duration",
    error: "Error",
  },
} as const;
