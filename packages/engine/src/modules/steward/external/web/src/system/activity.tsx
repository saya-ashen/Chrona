import { useEffect, useState } from "react";
import { Card, List, Stack, Time } from "../ui";
import { useQuery, QueryStatus } from "./query";
import { useAction } from "./action";
export type ActivityItem = {
  id: string;
  at: string;
  module: string | null;
  text: string;
  session?: { id: string; source: string };
};
export type ActivityPage = { items: ActivityItem[]; before: string | null };
export function ActivityList({ items, module = "" }: { items: ActivityItem[]; module?: string }) {
  return (
    <List empty="还没有活动。">
      {items.map((item) => (
        <Stack row key={item.id}>
          <Time value={item.at} />
          {item.module && !module ? (
            <a href={`/activity?module=${encodeURIComponent(item.module)}`}>{item.module}</a>
          ) : null}
          <span>{item.text}</span>
          {item.session ? (
            <a
              href={
                item.session.source === "build"
                  ? `/sessions/${item.session.id}`
                  : `/apps/system/${encodeURIComponent(String(item.module))}?session=${encodeURIComponent(item.session.id)}`
              }
            >
              查看过程
            </a>
          ) : null}
        </Stack>
      ))}
    </List>
  );
}
export function Activity({ module }: { module: string }) {
  const query = useQuery<ActivityPage>("activity", { module }),
    action = useAction();
  const [page, setPage] = useState<ActivityPage>();
  useEffect(() => {
    setPage(query.data);
  }, [query.data]);
  return (
    <Card title={module ? `活动 · ${module}` : "活动"}>
      <p className="muted">
        Chrona 做过的事：审批与你的决定、应用的检查、启用、自动更新、回滚和故障、授权、设置与凭据的改动（只记名称）。
      </p>
      {module ? <a href="/activity">看全部应用</a> : null}
      <QueryStatus query={query} />
      {page ? <ActivityList items={page.items} module={module} /> : null}
      {page?.before ? (
        <button
          type="button"
          disabled={action.pending}
          onClick={() =>
            void action.act(async () => {
              const next = (await action.call("activity", { module, before: page.before })) as ActivityPage;
              setPage({ items: [...page.items, ...next.items], before: next.before });
            })
          }
        >
          更早的
        </button>
      ) : null}
      {action.error ? (
        <p role="alert" className="error">
          {action.error}
        </p>
      ) : null}
    </Card>
  );
}
