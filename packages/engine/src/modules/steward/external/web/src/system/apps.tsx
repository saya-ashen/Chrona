import { Card, List, Stack } from "../ui";
import { faultText, runtimeText } from "./text";
import type { App, RuntimeCapability } from "./detail-types";
import { runtimeCapabilityText } from "./runtime";
import { AppRemoval, SystemAction } from "./components";
import { useQuery, QueryStatus } from "./query";
type ListedApp = App & { health: App["health"] & { incident?: { status: string } | null } };
type SystemApp = { name: string; description: string; runtime?: RuntimeCapability };
function AppControls({ app }: { app: ListedApp }) {
  const paused = app.status === "paused";
  return (
    <>
      {app.activeHash &&
      ((app.status === "active" && app.capabilities.disable) || (paused && app.capabilities.enable)) ? (
        <SystemAction
          props={{
            label: paused ? "恢复" : "暂停",
            tool: paused ? "module-enable" : "module-disable",
            args: { id: app.id },
            confirm: paused
              ? `恢复 ${app.name}？应用及随暂停停止的日程将恢复运行。`
              : `暂停 ${app.name}？应用和它的日程会停止，数据和文件会保留。`,
          }}
        />
      ) : null}
      {app.activeHash && app.capabilities.remove && app.status !== "migrating" ? (
        <AppRemoval props={{ moduleId: app.id, name: app.name }} />
      ) : null}
    </>
  );
}
export function AppsPage() {
  const apps = useQuery<ListedApp[]>("modules", {}, 5),
    system = useQuery<SystemApp[]>("system-apps");
  return (
    <Stack>
      <Card title="内核" description="Chrona 的系统接口与本机运行信息，不属于可安装或删除的模块。">
        <QueryStatus query={system} />
        {system.data ? (
          <List empty="当前没有已登记的内核接口。">
            {system.data.map((app) => (
              <div key={app.name}>
                <a href={`/apps/system/${encodeURIComponent(app.name)}`}>{app.name}</a>
                <p className="muted">{app.description}</p>
                {app.runtime ? (
                  <>
                    <p className="muted">{runtimeCapabilityText(app.runtime)}</p>
                    <p className="muted">{app.runtime.responsibility}</p>
                  </>
                ) : null}
              </div>
            ))}
          </List>
        ) : null}
      </Card>
      <Card
        title="模块"
        description="已安装的模块统一在这里管理；预装不增加权限。可用操作以各模块权限和当前状态为准，删除需要确认。"
      >
        <QueryStatus query={apps} />
        {apps.data ? (
          <List empty="还没有已安装的模块。">
            {apps.data.map((app) => (
              <div key={app.id}>
                <Stack row>
                  <a href={`/apps/${encodeURIComponent(app.id)}`}>{app.name}</a>
                  <AppControls app={app} />
                </Stack>
                <p className="muted">
                  {app.origin === "builtin" ? "内置" : "外置"} · {!app.capabilities.remove ? "当前不可删除。" : ""}
                  {!app.activeHash ? "尚未启用 · " : ""}
                  {runtimeText(app.health)} · {app.health.incident ? `${faultText(app.health.incident.status)} · ` : ""}
                  {app.description ?? ""}
                </p>
              </div>
            ))}
          </List>
        ) : null}
      </Card>
    </Stack>
  );
}
