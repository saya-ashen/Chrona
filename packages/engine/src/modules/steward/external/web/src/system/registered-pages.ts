/** Metadata returned by Web's page registry; ownership is the recorded module identity. */
export type RegisteredPage = { module: string; moduleId: string; id: string; title: string; purpose?: "settings" };
export type PageOwner = { id: string; name: string; status: string; activeHash?: string | null };
export const settingsHref = (moduleId: string) => `/apps/${encodeURIComponent(moduleId)}?tab=settings`;
export const pageHref = (page: RegisteredPage) => `/p/${encodeURIComponent(page.module)}/${encodeURIComponent(page.id)}`;
export const pagesForApp = (pages: RegisteredPage[] | undefined, app: PageOwner) =>
  app.status === "active" && app.activeHash ? (pages ?? []).filter(page => page.moduleId === app.id && page.module === app.name) : [];
export const settingsPageForApp = (pages: RegisteredPage[] | undefined, app: PageOwner) => pagesForApp(pages, app).find(page => page.purpose === "settings");
export function settingsUnavailable(pages: RegisteredPage[] | undefined, app: PageOwner) {
  if (app.status !== "active" || !app.activeHash) return "应用已暂停或尚未启用，恢复后可打开设置。";
  return pages ? "应用尚未登记设置页面。" : "正在读取应用设置入口……";
}
