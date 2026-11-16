import { TodayPage } from "./today";
import { LoginPage, type LoginMode } from "./login";
import { Activity } from "./activity";
import { AppsPage } from "./apps";
import { Settings } from "./settings";
import { Detail, type DetailRoute } from "./detail";
import { ChatPage } from "./chat";
import { Card } from "../ui";
export type SystemParams =
  | { name: "today" | "apps" | "settings" }
  | { name: "login"; message?: string; mode?: LoginMode }
  | { name: "activity"; module: string }
  | { name: "chat"; path: string }
  | { name: "chat-unavailable" | "error"; message: string }
  | ({ name: "app" | "system-app" } & DetailRoute);
export function SystemPage({ params }: { params: SystemParams }) {
  switch (params.name) {
    case "today":
      return <TodayPage />;
    case "apps":
      return <AppsPage />;
    case "settings":
      return <Settings />;
    case "login":
      return <LoginPage message={params.message} mode={params.mode} />;
    case "activity":
      return <Activity module={params.module} />;
    case "chat":
      return <ChatPage path={params.path} />;
    case "app":
    case "system-app":
      return <Detail route={params} system={params.name === "system-app"} />;
    case "chat-unavailable":
    case "error":
      return (
        <Card title={params.name === "error" ? "页面暂时无法打开" : "Chat 暂不可用"}>
          <p role="alert" className="error">
            {params.message}
          </p>
          <a href="/apps">检查应用</a>
        </Card>
      );
  }
}
