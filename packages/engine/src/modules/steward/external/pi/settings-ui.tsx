import { React, ui } from "/pages.js";
import type { PageHost } from "../web/src/registered-page";
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const labels = { off: "关闭", minimal: "最少", low: "较少", medium: "中等", high: "较多", xhigh: "更多", max: "最多" };
type Policy = {
  form?: { profile: string; model: string; thinking: string };
  effective: {
    profile: string;
    profileSource: string;
    profileStatus: string;
    model: string;
    modelSource: string;
    thinking: string;
    thinkingSource: string;
    warnings: string[];
  };
};
function usePage(host: PageHost) {
  const [policy, setPolicy] = React.useState<Policy>(),
    [models, setModels] = React.useState<{ value: string; label: string }[]>([]),
    [pending, setPending] = React.useState(false),
    [error, setError] = React.useState(""),
    [note, setNote] = React.useState("");
  const read = () =>
    host
      .call<Policy>("configure", { view: true })
      .then(setPolicy)
      .catch((error) => {
        console.error(JSON.stringify({ component: "pi", event: "settings_read_failed", error: String(error) }));
        setError(String(error));
      });
  const refresh = () =>
    host
      .call<{ options: { value: string; label: string }[] }>("models")
      .then((value) => setModels(value.options))
      .catch((error) => {
        console.error(JSON.stringify({ component: "pi", event: "models_read_failed", error: String(error) }));
        setError(`本地模型列表读取失败：${String(error)}`);
      });
  React.useEffect(() => {
    let active = true;
    void host
      .call<Policy>("configure", { view: true })
      .then((value) => {
        if (active) setPolicy(value);
      })
      .catch((error) => {
        console.error(JSON.stringify({ component: "pi", event: "settings_read_failed", error: String(error) }));
        if (active) setError(String(error));
      });
    void refresh();
    return () => {
      active = false;
    };
  }, []);
  const change = (key: string, value: string) =>
    setPolicy((current) => (current?.form ? { ...current, form: { ...current.form, [key]: value } } : current));
  const save = async (clear = false) => {
    if (pending) return;
    setPending(true);
    setError("");
    setNote("");
    try {
      setPolicy(
        await host.call<Policy>("configure", clear ? { clear: true, view: true } : { form: policy!.form, view: true }),
      );
      setNote("Pi 设置已保存。新建会话将使用新设置，已有和排队中的会话保留原设置。");
    } catch (error) {
      console.error(JSON.stringify({ component: "pi", event: "settings_save_failed", error: String(error) }));
      setError(String(error));
    } finally {
      setPending(false);
    }
  };
  const form = policy?.form,
    effective = policy?.effective;
  return { policy, models, pending, error, note, read, refresh, change, save, form, effective };
}
function Page({ host }: { host: PageHost }) {
  const { policy, models, pending, error, note, read, refresh, change, save, form, effective } = usePage(host);
  return (
    <ui.Stack>
      <p>选择 Pi 配置目录、模型和思考强度。留空可继承宿主和所选 Pi 配置。保存不会调用模型。</p>
      {error ? (
        <div role="alert">
          <p className="error">{error}</p>
          <ui.Button onClick={() => void read()}>重新读取设置</ui.Button>
        </div>
      ) : null}
      {!policy ? (
        <p role="status">正在读取 Pi 设置……</p>
      ) : !form ? (
        <p role="alert">Pi 设置暂时不可用，请检查配置目录、读取权限和所有者权限。</p>
      ) : (
        <ui.Card title="Pi 配置">
          <p>当前目录：{effective!.profile}</p>
          <p className="muted">
            目录来源：{effective!.profileSource}；状态：{effective!.profileStatus}
          </p>
          <p className="muted">
            configuration 表示应用选择；host.agentDir 表示宿主指定；env.PI_CODING_AGENT_DIR
            表示服务环境；default.HOME/.pi/agent 表示服务用户默认目录。
          </p>
          <p>
            当前模型：{effective!.model}（来源：{effective!.modelSource}）
          </p>
          <p>
            当前思考强度：{effective!.thinking}（来源：{effective!.thinkingSource}）
          </p>
          <p className="muted">{effective!.warnings.join("；")}</p>
          <ui.Input
            label="配置目录（规范绝对路径）"
            name="profile"
            value={form.profile}
            disabled={pending}
            onChange={(event) => change("profile", event.target.value)}
          />
          <p className="muted">填写已存在的规范绝对路径，不使用符号链接。留空继承配置。</p>
          <ui.Input
            label="模型（提供方/模型 ID）"
            name="model"
            value={form.model}
            disabled={pending}
            onChange={(event) => change("model", event.target.value)}
          />
          <ui.Select
            label="从当前已保存目录选择模型"
            name="local-model"
            value={form.model}
            options={models}
            disabled={pending}
            onChange={(event) => change("model", event.target.value)}
          />
          <ui.Button onClick={() => void refresh()} disabled={pending}>
            刷新本地模型列表
          </ui.Button>
          <p className="muted">模型列表仅从已保存目录读取 ID，不访问账号或联网验证。更换目录后请先保存，再刷新列表。</p>
          <ui.Select
            label="思考强度"
            name="thinking"
            value={form.thinking}
            disabled={pending}
            options={[
              { value: "", label: "继承所选 Pi 配置" },
              ...THINKING_LEVELS.map((value) => ({ value, label: labels[value] })),
            ]}
            onChange={(event) => change("thinking", event.target.value)}
          />
          <ui.Button variant="primary" disabled={pending} onClick={() => void save()}>
            {pending ? "正在保存 Pi 设置…" : "保存 Pi 设置"}
          </ui.Button>
          <ui.Button disabled={pending} onClick={() => void save(true)}>
            恢复继承设置
          </ui.Button>
        </ui.Card>
      )}
      {note ? <p role="status">{note}</p> : null}
    </ui.Stack>
  );
}
export default function mount(_element: HTMLElement, host: PageHost) {
  return host.render(<Page host={host} />);
}
