export type DashboardData = Awaited<
  ReturnType<typeof import("@chrona/engine/modules/pages/get-dashboard").getDashboard>
>;

export type DashboardFocusTask = NonNullable<DashboardData["focusTask"]>;
export type DashboardAttentionItem = DashboardData["needsAttention"][number];
export type DashboardInProgressItem = DashboardData["inProgress"][number];
export type DashboardCompletedItem = DashboardData["autoCompleted"][number];
export type DashboardCompletionCategory = DashboardCompletedItem["category"];
export type DashboardEvent = DashboardData["recentEvents"][number];
export type DashboardOutput = NonNullable<DashboardAttentionItem["latestOutput"]>;
