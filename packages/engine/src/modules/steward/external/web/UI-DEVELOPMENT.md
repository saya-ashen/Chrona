# 应用页面开发

Web 负责认证、主题、导航、`document` / `workspace` 布局和应用故障面板。应用拥有页面内容和设置，通过 `web.page-set` 登记普通 React / TSX 编译后的 ESM，无需独立 HTTP 服务。

先发现实际 Web moduleId 与 `page-set` / `catalog` 工具合同。以下 `web.*` 是应用 SDK 地址；Agent 使用发现到的 moduleId。`uses` 是合同声明，不授予权力。

## 页面与构建

页面默认导出 `mount(element, host)`，返回清理函数或 `{ destroy() }`。React、React DOM 和共享 UI 统一从 `/pages.js` 导入，构建时保留这个 external import，避免捆绑第二份 React。

```tsx
import { React, ui } from "/pages.js";

function Preferences({ host }) {
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  return <ui.Card title="偏好">
    <form onSubmit={async event => {
      event.preventDefault(); setSaving(true); setError("");
      try { await host.call("save", { name }); host.toast("已保存"); }
      catch (error) { console.error(error); setError(String(error)); }
      finally { setSaving(false); }
    }}>
      <ui.Input label="名称" value={name} disabled={saving} onChange={event => setName(event.target.value)} />
      {error ? <p role="alert">{error}</p> : null}
      <ui.Button type="submit" disabled={saving}>{saving ? "正在保存" : "保存"}</ui.Button>
    </form>
  </ui.Card>;
}
export default function mount(element, host) {
  return host.render(<Preferences host={host} />);
}
```

应用的 `build-ui.ts` 将 TSX 编译为浏览器 ESM，并生成导出 `javascript` 字符串的 `settings-bundle.js`（或 `page-bundle.js`）。在 Chrona 仓库运行 `bun build/application-pages.ts` 更新各应用的构建器及 bundle；独立应用运行 `bun build-ui.ts settings-ui.tsx settings-bundle.js`。Web 自身的内存设置使用 `bun build-ui.ts src/memory-settings.tsx settings-bundle.js`。源码、锁文件、构建器和生成字节一起进入版本材料。

```ts
import { javascript } from "./settings-bundle.js";
// 在应用自身的 activated handler 中执行：
await chrona.call("web.page-set", {
  id: "preferences", title: "应用偏好", purpose: "settings",
  layout: "document", javascript, tools: ["save"],
});
```

`page-set` 还接受可选 `css`、JSON `props` 和 `content: { tool }`。`props` 经 `host.props` 读取；不在 props 中放凭据。一个应用版本最多一个 `purpose: "settings"` 页面，嵌入应用详情设置标签。`page-remove {id}` 删除当前版本页面；`pages` 列出当前版本登记；`catalog` 返回当前运行时和开发规则。

## 宿主与生命周期

- `host.call(name, args)` 只调用页面声明的本应用工具，统一解析错误结果，对声明 `request-key` 的工具补齐 key；应用负责具体操作的状态和显式重试。响应丢失且副作用未知时保留原 key 核对回执。
- `host.navigate(path, replace?)` 使用 Web 路由；`host.confirm({title,message?})` 返回确认结果；`host.toast(message)` 显示状态反馈。
- `host.contentUrl(ref)` 通过当前页面声明的内容工具读取所属应用的受限图片，返回对象 URL。宿主在卸载时回收对象 URL，页面也应及时释放不再使用的 URL。
- `host.render(reactNode)` 挂载共享 React root，返回卸载函数。自行使用 `createRoot` 时自行卸载。

登记绑定真实应用 moduleId、活动批准 hash、页面 revision 及工具输入合同。认证后的源码路由 `/api/web/pages/:module/:id/source?revision=...` 返回精确版本 ESM，使 `/pages.js` 的相对同源导入正常解析。工具调用和内容读取携带页面 revision；停用、卸载、身份或版本变化及工具合同变化会使旧回调失效。保留同版本登记以支持停用后恢复和精确版本回滚。

可信页面直接运行在 Web 同一文档，不提供浏览器安全隔离。页面卸载时释放监听器、定时器、媒体、React root 和自建对象 URL。不要通过不可信内容执行脚本。

## 样式与验证

页面 UI 宿主在 `src/application-pages.tsx`，模块加载与清理在 `src/page-runtime.ts`。共享 UI 入口为 `src/ui.tsx`，工作区组件在 `src/workspace.tsx`；系统页面是 `src/system/*.tsx`。共享样式在 `src/base.css`、`src/pages.css`，外壳样式在 `shell.css`。应用 CSS 使用自己的根 class，继承 `--fg/--bg/--card/--muted/--line/--accent`，不添加全局标签规则。

工作区用 `Workspace`、`WorkspaceHeader`、`ScrollArea`、`Composer`；`Composer.onSubmit` 是普通 React 回调，`WorkspaceHeader.statusTone` 由应用提供。表单使用受控输入或原生表单，不将轮询结果覆盖未保存草稿。

离线测试真实 activated handler 和 Web 登记校验；浏览器验证空、加载、失败、等待、完成与重试。检查 1440×900、1024×768、390×844，手机无横向滚动，并验证页面切换清理、键盘操作和回调版本变化。测试不调用真实模型或真实账号。
