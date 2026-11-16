import { Card, List, Stack } from "../ui";
import type { SettingsView } from "./types";
import {
  settingsHref,
  settingsPageForApp,
  settingsUnavailable,
  type PageOwner,
  type RegisteredPage,
} from "./registered-pages";
import { LoginPasswordSettings } from "./password-forms";
import { NotificationSettings, ModuleModelSettings, RunTimeoutSettings } from "./settings-forms";
import { useQuery, QueryStatus } from "./query";
export type { GlobalSettings, SettingsView } from "./types";
export function Settings() {
  const view = useQuery<SettingsView>("settings"),
    pages = useQuery<RegisteredPage[]>("pages", {}, 30),
    apps = useQuery<PageOwner[]>("modules", {}, 5);
  const settings = view.data?.settings,
    current = settings?.moduleModel;
  return (
    <Stack>
      <Card title="登录密码">
        <LoginPasswordSettings />
      </Card>
      <Card title="内核">
        {view.data === undefined && !view.error ? (
          <p role="status">加载中……正在读取内核设置。</p>
        ) : (
          <QueryStatus query={view} />
        )}
        {settings ? (
          <>
            <h3>任务时限</h3>
            <RunTimeoutSettings
              props={{ settings: { timezone: settings.timezone, runTimeoutMinutes: settings.runTimeoutMinutes } }}
            />
            <h3>模型调用硬上限</h3>
            {!current ? <p className="muted">尚未启用模型调用额度；应用配置模型后仍需启用内核额度。</p> : null}
            <NotificationSettings props={{ settings: { timezone: settings.timezone }, section: "budget" }} />
            <ModuleModelSettings
              props={{ settings: { timezone: settings.timezone, moduleModel: current }, section: "caps" }}
            />
            <h3>今日应用模型调用用量</h3>
            <p className="muted">
              这里只统计应用通过受控补全接口报告的用量，不包含全部 Agent / Provider 会话；未报告用量不能当作零成本。
            </p>
            <List empty="今天还没有模块调用模型。">
              {(settings.modelUsage ?? []).map((row) => (
                <div key={row.module}>
                  <p>
                    {row.module}：{row.calls} 次
                  </p>
                  <p className="muted">
                    已报告输入 {row.inputTokens} / 输出 {row.outputTokens} token · {row.unreportedCalls ?? "未知"}{" "}
                    次用量未完整报告
                    {current?.moduleDailyCalls?.[row.module] !== undefined
                      ? ` · 上限 ${current.moduleDailyCalls[row.module]}`
                      : ""}
                  </p>
                </div>
              ))}
            </List>
          </>
        ) : null}
      </Card>
      <Card title="应用设置">
        <p className="muted">各应用提供自己的设置页面。</p>
        <QueryStatus query={apps} />
        <QueryStatus query={pages} />
        {apps.data ? (
          <List empty="还没有安装应用。">
            {apps.data.map((app) => {
              const page = settingsPageForApp(pages.data, app);
              return (
                <div key={app.id}>
                  <h3>{app.name}</h3>
                  {page ? (
                    <a href={settingsHref(app.id)}>打开设置</a>
                  ) : (
                    <p className="muted">{settingsUnavailable(pages.data, app)}</p>
                  )}{" "}
                  <a href={`/apps/${encodeURIComponent(app.id)}`}>查看应用</a>
                </div>
              );
            })}
          </List>
        ) : null}
      </Card>
    </Stack>
  );
}
