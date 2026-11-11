# Web 应用 UI 开发指南

本指南随 Web 版本材料交付。工具入口：精确查询当前 Web moduleId 的 component-set、page-set、catalog 合同，再调用 web.catalog 获取组件属性、事件和核心规则。这里的 web.* 是应用内部 SDK 地址；Agent 路由须使用发现到的 moduleId。不要给 Manifest 增加 documentation 字段。源码依据：src/base.css、shell.css、src/pages.css、src/workspace.tsx、src/executable-components.tsx。

## 选择渲染方式

优先用 catalog 中的共享声明式组件（如 Stack、Text、Workspace、WorkspaceHeader、ScrollArea、Composer）；先查具体 props/events，不猜参数。Composer 提交显式绑定 on.submit，WorkspaceHeader.statusTone 由应用提供。页面内 components 模板适合复用声明式结构，不能执行脚本。文件选择、音频、原生控件等需要浏览器能力时才用 component-set 的可信可执行组件。

## 主题与 CSS

组件在已鉴权 Web 同页运行，既没有 iframe、Shadow DOM，也没有 CSS 或脚本隔离。css 被写入普通 style。宿主样式会进入组件，组件全局规则也会污染宿主。

| 变量 | 语义 |
| --- | --- |
| --fg | 主文字及控件前景 |
| --bg | 页面底色、次级表面 |
| --card | 卡片、主要面板表面 |
| --muted | 次级文字 |
| --line | 边框、分隔线 |
| --accent | 强调色、交互提示 |
| --rail | 宿主导航底色 |
| --selection | 宿主选中底色 |
| --workspace-tint | 工作区轻强调底色 |
| --workspace-add / --workspace-remove | 增加 / 删除底色 |

--foreground、--background 不存在。实际继承值以组件所在位置的 computed style 为准；不要复制 :root 的色值，因为 body.web-shell-app 会覆盖它们。宿主通过 prefers-color-scheme: dark 切换亮暗主题；组件直接继承变量，背景与前景成对使用，例如 background:var(--card);color:var(--fg)。不要把浅色文字/背景硬编码后只替换其中一项。--accent 不保证白字对比度，尤其暗色模式；普通按钮可用 --bg/--fg，并用 --accent 表示边框或焦点。宿主局部工作区变量不是所有表面的通用设计 token。

每个组件创建独有根 class（例 music-player），所有选择器从它开始；不要写 :root、body、*、section、header 等全局选择器，不修改宿主 class 或主题变量。keyframes 名称也需应用前缀。宿主 base.css 的 header 会带 sticky/top、flex、padding 和底色，section 会带边框、圆角、间距；仅给根设置颜色不会消除这些规则。优先用带作用域 class 的 div；确需语义 section/header 时，在 .music-player .music-player__header 等精确选择器里显式设置 position、display、padding、margin、border、background、color。也检查宿主 button/input/pre 规则、继承字体及 box-sizing；不要用全局 reset。

## 布局与高度

page-set 显式选择 layout。document 为居中文档：桌面 max-width:64rem，padding:36px 32px，窄屏 padding:24px 16px；适合表单、说明、设置。workspace 去掉 main 的最大宽度与内边距，仍保留宿主导航。这个选项本身不替任意自定义组件计算剩余高度。

共享 Workspace 使用 visualViewport.height（否则 innerHeight）减自身 getBoundingClientRect().top，最少 240px，并在窗口/视觉视口变化时更新 --workspace-height。优先复用它。自定义组件确需满高时按自身实际顶部计算可用高度并监听 resize/visualViewport，清理监听；不要硬编码 900px，也不要假定 100vh 等于扣除宿主导航后的高度。容器用 min-width:0、min-height:0，滚动区用 overflow:auto，避免嵌套滚动与 flex 子项撑开。百分比高度需要已确定高度的祖先链。手机还要验证软键盘、侧栏与长文本。

## 最小可执行组件与 activated 注册

下面的 music 是示例应用名，实际 type 必须直接取注册返回值。应用须声明 activated 及 uses:["web.component-set","web.page-set"]，不要把它们当授权；由真实已激活版本的 handler 注册。以下代码放在应用自身入口，浏览器 JS 自包含，无 import，不另开 HTTP 服务。

```ts
import { chrona, on } from "chrona";
const javascript = `export default function mount(element, {props}) {
  const root = document.createElement('div');
  root.className = 'music-player';
  const label = document.createElement('p');
  root.append(label); element.append(root);
  const update = ({props}) => { label.textContent = props.title; };
  update({props});
  return { update, destroy() { root.remove(); } };
}`;
const css = `.music-player { min-width:0; max-width:100%; color:var(--fg); background:var(--card); padding:1rem; border:1px solid var(--line); border-radius:8px; overflow-wrap:anywhere; }
.music-player, .music-player * { box-sizing:border-box; }
.music-player p { margin:0; color:var(--fg); }`;
on("activated", async () => {
  const component = await chrona.call("web.component-set", {
    name: "Player", javascript, css,
    props: { type: "object", properties: { title: { type: "string" } },
      required: ["title"], additionalProperties: false }
  }) as { name: string; type: string; revision: string };
  await chrona.call("web.page-set", {
    id: "main", title: "播放器", layout: "document",
    spec: { root: "player", elements: {
      player: { type: component.type, props: { title: "音乐" }, children: [] }
    } }
  });
});
```

mount 必须同步返回清理函数或 {update?,destroy?}，不可返回 Promise。宿主更新 props 时调用 update(context)。组件替换后重新注册页面，页面固定真实应用 hash 与组件 revision。使用 textContent 展示外部文本。需要事件时在 events 声明后 emit(name)，需要工具时在 tools 声明自己的可见工具再 call(tool,args)；页面保留合同检查，不从浏览器参数自授身份。default children 和命名 slots 为 React 所有，须先声明 slots，不能移动、删除或重建这些容器。

卸载时移除自己的监听、定时器、ResizeObserver，撤销自己创建的 Object URL，停止音频/媒体轨道并释放文件引用；异步完成后检查是否已卸载。宿主会移除组件 style 与模块 Blob URL，但不会替组件清理任意外部资源。

## 验证分层

1. 合同/注册测试：版本材料提供 registration-test.ts 与 build.ts --registration-test-only /absolute/support-directory。这个 helper 需要 Chrona checkout 的合同依赖才能构建；导出的单个 .mjs 可供普通应用测试使用。createRegistrationTest(entry,{manifest?}) 后 activate()，最后 close()。它运行真实 activated 和 Web 注册校验，SDK 边界为替身；不调用真实应用工具、模型、网络或内核，不证明实际激活或浏览器行为。
2. 隔离组件测试：验证 mount/update/destroy、工具声明、事件、资源清理、错误和长文本。独立容器截图不会包含完整宿主级联，不能证明宿主视觉通过。
3. 真实宿主视觉测试：候选获 owner 审批并激活后，在当前真实 Web 中打开该应用注册页面，核对页面 moduleId/hash、组件 revision。用浏览器实际切换 prefers-color-scheme 的 light/dark，各检查 1440×900、1024×768、390×844 六种组合。记录 URL、版本、截图与失败。检查文字/背景对比、header/section 位置与间距、宿主导航未受污染、滚动、焦点、文件/音频交互及卸载。document.documentElement.scrollWidth 应不大于 clientWidth；视觉截图仍需人工判读。测试空、加载、错误、等待和完成状态；手机不得横向滚动。开发者工具设备模式和 Rendering 的颜色方案模拟可完成这些步骤；不要假设 web 工具提供浏览器操作或自动截图能力。

注册成功、内核激活、健康观察与浏览器验收分别报告。本说明候选不要求提前激活或改真实页面来测试；未执行的浏览器验证必须明确写为未执行。
