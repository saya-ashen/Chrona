import { React, ui } from "/pages.js";
import type { PageHost } from "../web/src/registered-page";
type Reminder = { key: string; label?: string; text: string; status: string; nextAt?: string };
function Page({ host }: { host: PageHost }) {
  const [items, setItems] = React.useState<Reminder[]>(),
    [error, setError] = React.useState("");
  const read = () =>
    host
      .call<{ reminders: Reminder[] }>("list")
      .then((value) => {
        setItems(value.reminders);
        setError("");
      })
      .catch((error) => {
        console.error(JSON.stringify({ component: "remind", event: "page_read_failed", error: String(error) }));
        setError(String(error));
      });
  React.useEffect(() => {
    void read();
  }, []);
  const labels: Record<string, string> = {
    active: "等待提醒",
    paused: "已暂停",
    unknown: "投递结果未知，已暂停后续提醒，请核查通知记录。",
    finished: "提醒已结束",
  };
  return (
    <ui.Card title="我的提醒">
      {error ? (
        <div role="alert">
          <p className="error">{error}</p>
          <ui.Button onClick={() => void read()}>重试读取提醒</ui.Button>
        </div>
      ) : null}
      {!items ? (
        <p role="status">正在读取提醒……</p>
      ) : (
        <ui.List empty="还没有提醒。你可以在对话中告诉 Chrona 提醒的时间和内容。">
          {items.map((item) => (
            <div key={item.key}>
              <h3>{item.label}</h3>
              <p>{item.text}</p>
              <p className="muted">{labels[item.status] ?? item.status}</p>
              {item.nextAt ? <ui.Time value={item.nextAt} /> : null}
            </div>
          ))}
        </ui.List>
      )}
    </ui.Card>
  );
}
export default function mount(_element: HTMLElement, host: PageHost) {
  return host.render(<Page host={host} />);
}
