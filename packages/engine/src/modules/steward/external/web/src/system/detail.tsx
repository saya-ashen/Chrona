import { Card, List, Stack, Time } from "../ui";
import { AppSettings } from "../application-pages";
import {
  pageHref,
  settingsHref,
  pagesForApp,
  settingsPageForApp,
  settingsUnavailable,
  type RegisteredPage,
} from "./registered-pages";
import { runtimeText } from "./text";
import { DiagnosticsPanel } from "./diagnostics";
import { ActivityList, type ActivityItem } from "./activity";
import { toolLabel, type App, type Overview, type Tool } from "./detail-types";
import { runtimeCapabilityText, runtimeCapabilityBoundary } from "./runtime";
import { ToolForm, ToolContract } from "./forms";
import { MemoryPanel } from "./detail-components";
import { SystemAction } from "./components";
import { useQuery, QueryStatus } from "./query";
export const APP_TABS = [
  ["overview", "概览"],
  ["settings", "设置"],
  ["tools", "工具（高级）"],
  ["activity", "活动"],
  ["versions", "版本"],
];
export const SYSTEM_TABS = [
  ["overview", "概览"],
  ["tools", "工具"],
  ["activity", "活动"],
];
export const selectedTab = (tab: string, system = false, session = "") =>
  session ? "overview" : (system ? SYSTEM_TABS : APP_TABS).some(([key]) => key === tab) ? tab : "overview";
export type DetailRoute = { id: string; tab: string; session: string };
export const toolsForModule = (tools: Tool[] | undefined, name: string) =>
  (tools ?? []).filter((tool) => toolLabel(tool).startsWith(`${name}.`));
function Contracts({ name, system }: { name: string; system: boolean }) {
  const tools = useQuery<Tool[]>("tools", { query: name }),
    user = useQuery<Tool[]>("tools", { query: name, audience: "user" }, 0, !system);
  const allowed = new Set(toolsForModule(user.data, name).map((tool) => JSON.stringify(tool.target)));
  return (
    <>
      <p className="muted">这里只展示当前可发现的合同；能否执行由调用时的权限和模块状态决定。</p>
      <QueryStatus query={tools} />
      {!system ? <QueryStatus query={user} /> : null}
      {tools.data ? (
        <List empty="当前没有可发现的工具。">
          {toolsForModule(tools.data, name).map((tool) => (
            <div key={JSON.stringify(tool.target)}>
              <ToolContract props={{ tool }} />
              {allowed.has(JSON.stringify(tool.target)) ? <ToolForm props={{ tool }} /> : null}
            </div>
          ))}
        </List>
      ) : null}
    </>
  );
}
function AppOverview({ app, pages }: { app: App; pages?: RegisteredPage[] }) {
  const statuses: Record<string, string> = {
      active: app.activeHash ? "已启用" : "尚未启用",
      paused: "已暂停",
      migrating: "数据处理中",
    },
    settings = settingsPageForApp(pages, app);
  return (
    <>
      <p>
        {app.origin === "builtin" ? "内置" : "外置"} · {statuses[app.status] ?? app.status} · {runtimeText(app.health)}
      </p>
      {app.origin === "builtin" && !app.capabilities.update ? (
        <p className="muted">受保护模块，代码随 Chrona 发版更新；可查看状态、工具合同和诊断。</p>
      ) : null}
      <p>{app.description}</p>
      <h3>当前版本 {String(app.activeHash || "无").slice(0, 8)}</h3>
      <a href={`/activity?module=${encodeURIComponent(app.name)}`}>查看全部活动</a>
      <p>
        {settings ? (
          <a href={settingsHref(app.id)}>打开设置</a>
        ) : (
          <span className="muted">{settingsUnavailable(pages, app)}</span>
        )}
      </p>
      {pagesForApp(pages, app)
        .filter((page) => page.purpose !== "settings")
        .map((page) => (
          <p key={page.id}>
            <a href={pageHref(page)}>打开{page.title}</a>
          </p>
        ))}
      <p className="muted">更多操作可在工具（高级）中查看。</p>
    </>
  );
}
function Versions({ app }: { app: App }) {
  return (
    <List empty="还没有版本记录。">
      {app.versions.slice(0, 20).map((version) => (
        <div key={version.hash}>
          <Time value={version.createdAt} />
          <p>
            {version.hash.slice(0, 8)} · {version.hash === app.activeHash ? "当前" : version.status}
          </p>
          {version.errors ? <p className="error">{version.errors.join("；")}</p> : null}
          {app.capabilities.rollback &&
          app.status !== "migrating" &&
          app.activeHash &&
          version.status === "approved" &&
          version.hash !== app.activeHash ? (
            <SystemAction
              props={{
                label: "回滚到此版本",
                tool: "module-rollback",
                args: { id: app.id, hash: version.hash },
                confirm: `回滚 ${app.name} 到 ${version.hash.slice(0, 8)}？如需恢复数据，会另行请你确认。`,
              }}
            />
          ) : null}
        </div>
      ))}
    </List>
  );
}
function AppActivity({ app }: { app: App }) {
  const recent = useQuery<ActivityItem[]>("detail-activity", { module: app.name });
  return (
    <>
      <QueryStatus query={recent} />
      {recent.data ? <ActivityList items={recent.data} module={app.name} /> : null}
      <a href={`/activity?module=${encodeURIComponent(app.name)}`}>查看全部活动</a>
      <h3>最近运行</h3>
      <List empty="还没有运行记录。">
        {app.runs.map((run) => (
          <div key={run.createdAt}>
            <Time value={run.createdAt} />
            <p className={run.error ? "error" : undefined}>
              {run.triggerId} ·{" "}
              {run.error ||
                (run.exitCode === null ? "尚无退出结果" : run.exitCode === 0 ? "成功" : `退出码 ${run.exitCode}`)}
            </p>
          </div>
        ))}
      </List>
      <DiagnosticsPanel id={app.id} name={app.name} />
    </>
  );
}
function KernelOverview({ view, id }: { view: Overview; id: string }) {
  return (
    <>
      {view.runtime ? (
        <>
          <p>{view.runtime.responsibility}</p>
          <p>{runtimeCapabilityText(view.runtime)}</p>
          <p>{view.runtime.configuration}</p>
        </>
      ) : (
        <p>{view.description}</p>
      )}
      {id === "memory" ? <MemoryPanel /> : null}
      {id === "modules" ? (
        <>
          <h2>模块创作</h2>
          <p className="muted">
            普通 author 模块通过准备、写入、读取、列出文件、查看源码、提交和回执工具处理创作材料。
          </p>
          <a href="/apps">查看 Author 应用及工具</a>
        </>
      ) : null}
      {id === "agent" ? <a href="/settings">打开内核预算设置</a> : null}
    </>
  );
}
function KernelActivity({ name }: { name: string }) {
  const recent = useQuery<ActivityItem[]>("detail-activity", { module: name });
  return (
    <>
      <QueryStatus query={recent} />
      {recent.data ? <ActivityList items={recent.data} module={name} /> : null}
    </>
  );
}
export function Detail({ route, system = false }: { route: DetailRoute; system?: boolean }) {
  const overview = useQuery<Overview>("overview", { id: route.id }, 5),
    pages = useQuery<RegisteredPage[]>("pages", {}, 5, !system);
  if (!overview.data) return <QueryStatus query={overview} />;
  const view = overview.data,
    app = view.app;
  if (!system && !app)
    return (
      <Card title="应用">
        <p role="alert">没有这个应用</p>
      </Card>
    );
  const tabs = system
    ? SYSTEM_TABS
    : APP_TABS.filter(
        ([key]) =>
          key !== "versions" || app!.origin === "external" || app!.capabilities.update || app!.capabilities.rollback,
      );
  const selected = selectedTab(route.tab, system, system ? route.session : ""),
    tab = tabs.some(([key]) => key === selected) ? selected : "overview";
  const base = `/apps/${system ? `system/${encodeURIComponent(route.id)}` : encodeURIComponent(app!.id)}`;

  return (
    <Card title={system ? `${route.id} · 内核` : app!.name}>
      {system ? (
        <p className="muted">
          内核接口，随 Chrona 版本更新。{view.runtime ? runtimeCapabilityBoundary : "在此查看合同与运行记录。"}
        </p>
      ) : null}
      <nav className="tabs" aria-label="应用标签">
        {tabs.map(([key, label]) => (
          <a
            key={key}
            href={`${base}?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={tab === key ? "selected" : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <Stack>
        <DetailContent tab={tab} system={system} route={route} view={view} app={app} pages={pages} />
      </Stack>
    </Card>
  );
}

function DetailContent({
  tab,
  system,
  route,
  view,
  app,
  pages,
}: {
  tab: string;
  system: boolean;
  route: DetailRoute;
  view: Overview;
  app?: App;
  pages: ReturnType<typeof useQuery<RegisteredPage[]>>;
}) {
  const name = system ? route.id : app!.name;
  switch (tab) {
    case "tools":
      return <Contracts name={name} system={system} />;
    case "settings":
      return <ApplicationSettings app={app!} pages={pages} />;
    case "versions":
      return <Versions app={app!} />;
    case "activity":
      return system ? <KernelActivity name={name} /> : <AppActivity app={app!} />;
    default:
      return system ? <KernelOverview view={view} id={route.id} /> : <AppOverview app={app!} pages={pages.data} />;
  }
}
function ApplicationSettings({ app, pages }: { app: App; pages: ReturnType<typeof useQuery<RegisteredPage[]>> }) {
  const settings = settingsPageForApp(pages.data, app);
  return (
    <>
      <QueryStatus query={pages} />
      {settings ? (
        <AppSettings
          key={`${app.id}:${app.activeHash}:${settings.id}`}
          entry={{ ...settings, activeHash: app.activeHash }}
        />
      ) : (
        <p className="muted">{settingsUnavailable(pages.data, app)}</p>
      )}
    </>
  );
}
