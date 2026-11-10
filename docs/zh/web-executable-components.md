# Web 应用组件登记与执行

2026-11-09：实现与隔离验收完成，尚未部署。本次范围是普通应用向 Web 登记浏览器组件，并由 Web 页面加载和渲染；不增加内核接口，不为普通应用新增 HTTP 入口。

## 运行边界

组件是可信本地应用的 Web 扩展。JavaScript 直接在 Web 页面的浏览器环境运行，能够使用 DOM、原生文件选择和音频等浏览器能力。这里没有 iframe、沙箱或恶意代码隔离；应用命名空间、版本绑定和工具调用检查不构成浏览器代码安全隔离。安装、候选检查及激活仍沿用现有应用生命周期。

应用调用 `web.component-set` 登记组件，再通过 `web.page-set` 在自己的页面引用。Web 根据真实调用者确定所属应用，存储实现和组件契约，提供经过认证的资源读取，并负责加载、呈现、更新和清理。组件自身不需要声明 `listen`。

已有随页面提供的声明式 `components` 继续用于组合公共组件，见 [Web 外壳与应用组合组件](web-components-and-shell.md)。执行组件与声明式组合是 Web 应用的两种呈现机制，不产生新的内核能力类别。

## 登记契约

`web.component-set` 接受以下字段：

- `name`：大写字母开头的组件名，例如 `AudioPlayer`。
- `javascript`：自包含 JavaScript ESM，默认导出同步 `mount(element, context)` 函数；不支持模块 imports。
- `css`：可选样式，与组件同页运行，不提供样式隔离。
- `props`：JSON Schema 对象，包含 `type: "object"`、`properties`、可选 `required` 和 `additionalProperties: false`。支持原始类型、标量 enum/const、带类型的字符串和数值约束、嵌套对象与数组，最多嵌套 16 层；不支持 refs、组合 schema、format、contains 等关键字，登记时会明确拒绝。
- `events`、`slots`、`tools`：可选且不重复的名称数组，每项最多 16 个。工具填写所属应用自己的工具名，例如 `list`；默认子节点需要声明 `slots: ["default"]`。

单个组件连同契约和身份信息最多 256 KiB，每个应用最多 16 个，Web 总计最多 256 个。登记返回 `{name, type, revision}`，其中 `type` 已带真实应用名前缀，例如 `local-player:Player`。页面应原样使用返回的 `type`；`app:Player` 中的 `app` 只是文档占位符，不能作为实际前缀提交。Web 从 SDK 事件取得真实应用名、moduleId 和 hash，只接受当前启用且获批版本，不接受参数代替身份。持久化文件为 Web 私有的 `executable-components.json`，通过临时文件与原子重命名保存，文件权限为 0600；重启读取会验证结构、大小及 revision。

页面使用 `应用名:组件名`，例如 `player:AudioPlayer`。登记页面时 Web 验证组件 props、事件、插槽和子节点，绑定组件 revision，并将组件声明的工具加入页面原有的工具身份和契约绑定。可执行组件不能与内置组件或同应用声明式组件重名。

`web.component-remove {name}` 删除所属应用的登记。组件换版、移除、应用身份/hash 变化或停用后，旧资源读取和旧页面调用失效；应用需要重新登记页面。同版本停用再启用可恢复原登记。已经在浏览器运行的可信 JavaScript 不会被远程强制卸载；关闭或切换页面时执行组件清理，后续工具调用仍经过当前服务端校验。

## 提交前执行实际激活登记

应用提交前必须执行真实入口注册的 `activated` handler，检查 `component-set → 返回的 type → page-set → 已保存页面`，不能只检查手工编写的调用参数。测试支持由 Web 应用维护，不增加 SDK 或内核公共接口，也不自动接入 `candidate-check`。

当前支持一条有明确边界的工作流：先在**与目标 Web 版本一致的现有 Chrona 源码工作区**构建便携 helper，再把生成的单个文件带到普通应用工作区运行。此生成步骤需要仓库内共享契约；仅有导出的 Web 源码或 SDK 时，不能直接运行 `registration-test.ts`，应取得匹配版本构建的 `registration-test.mjs`。例如应用真实入口和 `module.json` 都位于 `/absolute/app-workspace`：

```sh
cd /absolute/Chrona-checkout
bun run packages/engine/src/modules/steward/external/web/build.ts --registration-test-only /absolute/app-workspace/test-support
cd /absolute/app-workspace
bun --no-install test ./web-registration.bun.test.ts
```

`--registration-test-only` 只在指定目录生成 `registration-test.mjs`，不重建 `pages.js`、`style.css` 或材料记录。普通 `bun run build.ts` 仍独立重建导出 Web 源码的浏览器产物。该 helper 包含真实 Web 组件／页面、manifest、工具参数／输出及回调契约校验器；复制完成后不需要 Chrona 仓库、SDK preload、`DATABASE_URL` 或 helper 自身的 `node_modules`。应用自身的其他 imports 仍须在本地可解析，命令禁止自动安装依赖。要随应用保留测试材料，应明确把 helper 文件纳入材料；Web 默认浏览器构建不会自动导出它。

在应用工作区保存以下 `web-registration.bun.test.ts`。示例假定实际 manifest 的 `name` 为 `local-player`、入口为 `index.ts`，激活逻辑登记 `Player` 组件及 `player` 页面；其他应用应修改对应断言，保持被测入口为实际应用源码：

```typescript
import { expect, test } from "bun:test";
import { join } from "node:path";
import { createRegistrationTest } from "./test-support/registration-test.mjs";

test("实际激活使用 Web 返回的组件类型并保存页面", async () => {
  const h = await createRegistrationTest(join(import.meta.dirname, "index.ts"));
  try {
    await h.activate();
    const component = h.calls.find(call => call.target === "web.component-set")?.result;
    expect(component).toMatchObject({ name: "Player", type: "local-player:Player" });
    const page = await h.pages.get("local-player", "player");
    expect(page).toMatchObject({
      moduleId: h.caller.moduleId, hash: h.caller.hash,
      spec: { elements: { player: { type: component.type } } },
      extensions: { [component.type]: { revision: component.revision } },
    });
  } finally {
    await h.close();
  }
});
```

应用激活实现也应先保存 `const component = await chrona.call('web.component-set', ...)`，再在页面中使用 `type: component.type`。如果实际 handler 仍写死 `app:Player`，`h.activate()` 会被真实页面校验器拒绝，错误指明未知类型、真实应用前缀及 `web.component-set`；不得用捕获异常后直接通过测试的方式绕过。

`createRegistrationTest` 默认读取入口旁的 `module.json`；入口在子目录或测试编译后的入口时，可传入 `{manifest: absoluteManifestPath}`。身份和回调工具来自已验证 manifest，测试中的 moduleId/hash 是隔离测试值；可用 options 覆盖以验证绑定，但它们不代表真实获批版本。临时存储由 `h.close()` 删除，调用记录保存在 `h.calls`，真实页面操作位于 `h.pages`。

此 helper 支持 `on('activated')`、`chrona.paths`、同步 `chrona.call` 的 `web.*` 调用及 `ModelError`。其他 SDK imports、其他路由目标或异步投递模式会失败，需要应用另行测试相应初始化流程。它在同一进程执行可信应用代码，不是沙箱；不会运行内核激活、应用工具处理器或浏览器加载器。下面历史浏览器验收记录与该登记测试是不同证据；原生文件选择、真实播放、页面布局和版本失效仍需各自实际验收。

## 浏览器生命周期

经过认证的 `GET /api/web/components/:app/:name?revision=...` 返回实现及其身份和契约元数据。页面 `extensions` 携带组件 revision、props、events、slots 和 tools；加载器核对应用身份、hash 和 revision 后，以 Blob ESM 加载实现。CSP 允许所需 Blob 脚本和本地音频，以及组件样式。

`mount(element, context)` 返回清理函数，或者 `{update?, destroy?}`：

```javascript
export default function mount(element, context) {
  const input = document.createElement("input");
  input.type = "file";
  element.append(input);
  return {
    update(next) { input.title = next.props.title ?? "选择文件"; },
    destroy() { input.remove(); }
  };
}
```

`context.props` 读取最新 props；`emit(event)` 触发已声明页面事件；`call(tool, args)` 调用组件声明的所属应用工具，并沿用页面 revision、工具身份和契约检查。`children` 提供默认子节点容器，`slots` 提供命名插槽容器；这些容器由 React 管理。props 更新保持同一个挂载实例，避免丢失原生文件选择及播放状态。

加载或同步执行失败时显示中文错误和重试按钮。卸载、失败及重试会清理组件、样式和加载用 Blob URL；组件自行创建的媒体 URL、监听器及其他资源应在自己的清理函数中释放。已经卸载的组件不能继续通过上下文发出有效调用。

## 验证记录

实际浏览器验收使用隔离的 `createPages` 存储、生产 `moduleCall` 处理器和从实际前端源构建的渲染器，并通过本地工具适配器完成调用。桌面 1440×900、平板 1024×768、手机 390×844 共 45 项检查通过：原生文件选择、生成 WAV 的实际播放进度及暂停、props 更新保留文件、声明事件和工具回调、失效版本与停用、失败重试、卸载清理、Blob URL 释放及无横向溢出。报告与截图位于 `.tmp/web-executable-components/report.json` 和 `gallery.html`，源快照漂移为空。通用材料集成后的最新 45/45 复验报告位于 `.tmp/web-executable-components/runs/2026-11-09T14-10-35.668Z/report.json`。

首次浏览器运行明确发现 CSP 缺少 Blob 音频许可，39/45 通过；补充 `media-src 'self' blob:` 后，最终运行 45/45 通过。没有用空音频控件或伪造播放函数替代播放证明。

最终检查结果：

- 根目录 TypeScript 检查通过；以 `LINT_RATCHET_BASE=HEAD` 运行 lint ratchet 通过，9 个已跟踪改动文件未增加告警；新增后端文件及重构后的页面模块另行执行 scoped ESLint，0 错误、0 告警。
- 官方隔离运行器执行可执行组件、声明式组合、设置页面和实际 SDK 用例，4 个文件共 65 项通过；浏览器加载器另有 11 项 Bun 测试通过。实际 SDK 用例覆盖登记、资源读取、真实加载器契约、页面工具绑定及版本失效。
- 相邻系统页面、聊天界面、图片及内联设置回归共 10 项通过。生产服务器监听与认证回归单独通过 1 项。
- 最终浏览器再次验收 45/45 通过，源快照漂移为空。Chromium 156.0.8078.47，headless 模式，使用 `no-user-gesture-required` 自动播放策略；证明范围包括真实本地 WAV 播放，不代表所有浏览器自动播放策略。
- 独立审查发现的 CSP 音频许可、递归 schema 引用和不受支持 schema 关键字问题均已修复并加入验证。
- 首轮组件实现的离线提交为 `4ded683dc27cac0272914c79850277da13c49318`。后续通用版本材料集成采用源码与产物分离，当前 Web 提交为 `16034e497bd7437c0fa5937f4f7a43ef38071f3b`，bundle SHA-256 为 `f91af31c79869cb5060170c187d28b74189d8ce0e72793733035a440a42a9072`。Git 内 91 个源码及记录文件共约 695 KB；编译的 `pages.js`、`style.css` 单独作为运行产物，材料记录绑定摘要。源码克隆可独立离线重建并核对两份产物，详见 `author-version-materials.md`。后续集成仅发布 Author、Web、MCP、QQ 四项的追踪离线资源变更，保留其他资源。

日志分别为 `/tmp/chrona-web-executable-static-final.log`、`/tmp/chrona-web-executable-focused-final.log`、`/tmp/chrona-web-executable-loader-final.log`、`/tmp/chrona-web-executable-adjacent.log`、`/tmp/chrona-web-executable-browser-final.log` 和 `/tmp/chrona-web-executable-package.log`。隔离浏览器使用本地工具目录和应用状态适配器，不替代真实已安装应用、内核全链路或真实模型验收。上述验收不代表真实播放器候选已经通过检查或安装，也不代表真实模型完成任务。没有修改运行中的服务或用户数据；未部署、提交或推送。
