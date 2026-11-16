// Generated from entry-app/memory-settings.tsx by build/application-pages.ts.
import { React, ui } from "/pages.js";
import type { PageHost } from "./registered-page";
type Preferences = { provider: string; autoRecall: boolean; autoRetain: boolean };
type SavedPreference = { id: string; text: string };
function usePage(host: PageHost) {
  const [config, setConfig] = React.useState<Preferences>(),
    [preferences, setPreferences] = React.useState<SavedPreference[]>([]),
    [error, setError] = React.useState(""),
    [pending, setPending] = React.useState(false),
    [note, setNote] = React.useState("");
  const read = () =>
    host
      .call<Preferences>("ui-settings")
      .then((value) => {
        setConfig(value);
        setError("");
      })
      .catch((error) => {
        console.error(JSON.stringify({ component: "settings", event: "read_failed", error: String(error) }));
        setError(String(error));
      });
  React.useEffect(() => {
    void read();
    if (host.props.preferences)
      void host
        .call<{ items: SavedPreference[] }>("ui-preferences")
        .then((value) => setPreferences(value.items))
        .catch((error) => {
          console.error(JSON.stringify({ component: "settings", event: "preferences_failed", error: String(error) }));
          setError(`偏好读取失败：${String(error)}`);
        });
  }, []);
  const save = async () => {
    if (!config || pending) return;
    setPending(true);
    setError("");
    setNote("");
    try {
      setConfig(
        await host.call<Preferences>("ui-settings", {
          provider: config.provider,
          "auto-recall": config.autoRecall,
          "auto-retain": config.autoRetain,
        }),
      );
      setNote("设置已保存");
    } catch (error) {
      console.error(JSON.stringify({ component: "settings", event: "save_failed", error: String(error) }));
      setError(String(error));
    } finally {
      setPending(false);
    }
  };
  const forget = async (id: string) => {
    if (!(await host.confirm({ title: "删除这条偏好？" }))) return;
    try {
      const value = await host.call<{ items: SavedPreference[] }>("ui-preferences", { forget: id });
      setPreferences(value.items);
    } catch (error) {
      console.error(JSON.stringify({ component: "settings", event: "forget_failed", error: String(error) }));
      setError(String(error));
    }
  };
  return { config, setConfig, preferences, error, pending, note, read, save, forget };
}
function Page({ host }: { host: PageHost }) {
  const { config, setConfig, preferences, error, pending, note, read, save, forget } = usePage(host);
  return (
    <ui.Stack>
      <p>设置仅用于本应用的会话记忆。留空记忆提供应用可关闭记忆。</p>
      {error ? (
        <div role="alert">
          <p className="error">{error}</p>
          <ui.Button onClick={() => void read()}>重新读取设置</ui.Button>
        </div>
      ) : null}
      {config ? (
        <ui.Card title="会话记忆">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <ui.Input
              label="记忆提供应用"
              name="provider"
              placeholder="例如 memory-local；留空关闭记忆"
              value={config.provider}
              disabled={pending}
              onChange={(event) => setConfig({ ...config, provider: event.target.value })}
            />
            <label className="check">
              <input
                type="checkbox"
                name="autoRecall"
                checked={config.autoRecall}
                disabled={pending}
                onChange={(event) => setConfig({ ...config, autoRecall: event.target.checked })}
              />
              自动回忆
            </label>
            <label className="check">
              <input
                type="checkbox"
                name="autoRetain"
                checked={config.autoRetain}
                disabled={pending}
                onChange={(event) => setConfig({ ...config, autoRetain: event.target.checked })}
              />
              自动保留记忆
            </label>
            <ui.Button type="submit" variant="primary" disabled={pending}>
              {pending ? "正在保存……" : "保存设置"}
            </ui.Button>
          </form>
        </ui.Card>
      ) : (
        <p role="status">正在读取应用设置……</p>
      )}
      {note ? <p role="status">{note}</p> : null}
      {host.props.preferences ? (
        <ui.Card title="记忆应用保存的偏好">
          <ui.List empty="还没有保存的偏好。">
            {preferences.map((item) => (
              <div key={item.id}>
                <p>{item.text}</p>
                <ui.Button onClick={() => void forget(item.id)}>删除这条偏好</ui.Button>
              </div>
            ))}
          </ui.List>
        </ui.Card>
      ) : null}
    </ui.Stack>
  );
}
export default function mount(_element: HTMLElement, host: PageHost) {
  return host.render(<Page host={host} />);
}
