import { React, ui } from "/pages.js";
import type { PageHost } from "../web/src/registered-page";
const fields = [
  ["daily-cap", "每日主动通知上限（0–50）", "number"],
  ["timezone", "时区（例如 Asia/Shanghai）", "text"],
  ["digest-at", "每日摘要时间（HH:mm）", "text"],
  ["quiet-start", "免打扰开始（HH:mm）", "text"],
  ["quiet-end", "免打扰结束（HH:mm）", "text"],
];
function Page({ host }: { host: PageHost }) {
  const [form, setForm] = React.useState<Record<string, string>>(),
    [pending, setPending] = React.useState(false),
    [error, setError] = React.useState(""),
    [note, setNote] = React.useState("");
  const read = () =>
    host
      .call<{ form: Record<string, string> }>("ui-settings")
      .then((value) => {
        setForm(value.form);
        setError("");
      })
      .catch((error) => {
        console.error(JSON.stringify({ component: "notify", event: "settings_read_failed", error: String(error) }));
        setError(String(error));
      });
  React.useEffect(() => {
    void read();
  }, []);
  const save = async () => {
    if (pending) return;
    setPending(true);
    setError("");
    setNote("");
    try {
      const value = await host.call<{ form: Record<string, string> }>("ui-settings", { form });
      setForm(value.form);
      setNote("通知设置已保存");
    } catch (error) {
      console.error(JSON.stringify({ component: "notify", event: "settings_save_failed", error: String(error) }));
      setError(String(error));
    } finally {
      setPending(false);
    }
  };
  return (
    <ui.Stack>
      <p>
        设置主动通知的每日上限、时区和摘要时间。免打扰可跨午夜；开始和结束都留空即可关闭。对你请求的回复不占主动通知额度。
      </p>
      {error ? (
        <div role="alert">
          <p className="error">{error}</p>
          <ui.Button onClick={() => void read()}>重新读取设置</ui.Button>
        </div>
      ) : null}
      {form ? (
        <ui.Card title="通知偏好">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {fields.map(([name, label, type]) => (
              <ui.Input
                key={name}
                label={label}
                name={name}
                type={type}
                value={form[name]}
                disabled={pending}
                onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))}
              />
            ))}
            <ui.Button type="submit" variant="primary" disabled={pending}>
              {pending ? "正在保存……" : "保存通知设置"}
            </ui.Button>
          </form>
        </ui.Card>
      ) : (
        <p role="status">正在读取通知设置……</p>
      )}
      {note ? <p role="status">{note}</p> : null}
    </ui.Stack>
  );
}
export default function mount(_element: HTMLElement, host: PageHost) {
  return host.render(<Page host={host} />);
}
