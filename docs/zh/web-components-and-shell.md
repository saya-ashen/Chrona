# Web 页面与外壳

Web 是普通应用，负责认证、导航、主题和页面布局。业务应用通过 `web.page-set` 登记自己的 React / TSX 编译页面；内核不承载业务 UI。页面共享 React runtime、基础组件与 Design Tokens，不再使用 JSON 页面 DSL。

## 代码组织

| 责任 | 源码 |
| --- | --- |
| 认证、路由、导航、单一 SSE 连接 | `external/web/app.js` |
| 页面持久登记、调用者/版本/工具合同验证 | `external/web/pages.ts` |
| 浏览器运行时导出、系统页挂载 | `external/web/src/pages.tsx` |
| 应用页面显示、设置嵌入、反馈 | `external/web/src/application-pages.tsx` |
| ESM 加载、宿主 API、资源清理 | `external/web/src/page-runtime.ts` |
| 浏览器宿主合同与固定 revision 回调 | `external/web/src/registered-page.ts` |
| 共享 React UI / 工作区组件 | `external/web/src/ui.tsx`、`src/workspace.tsx` |
| 今天、应用、活动、设置、登录、会话等系统页面 | `external/web/src/system/*.tsx` |
| 系统 API adapter、本地数据查询与状态 | `src/system/adapter.ts`、`query.tsx`、`action.ts` |
| 应用私有页面 | 各应用的 `settings-ui.tsx` / `page-ui.tsx` 或现有 workspace UI |
| 浏览器 bundle 生成 | `build/application-pages.ts`、各应用 `build-ui.ts`、Web `build.ts` |

系统页面是普通 React 组件，直接复用已有表单、会话流和故障面板，通过系统 adapter 读取认证 API。应用页面只能通过自己的宿主调用声明工具，不获得系统 adapter。轮询保留已挂载页面、草稿和滚动位置，读取失败有错误与重试；请求过期结果不覆盖新页面。

页面显式选择 `layout: document|workspace`。应用设置依 `purpose: settings` 登记，由应用详情嵌入。Web 不根据工具名推断设置界面。共享 React 和 UI 从同源 `/pages.js` 导出；源码由认证路由返回并核对 revision。可信页面直接同页运行，没有浏览器隔离。

## 样式与交互

`src/base.css` 提供基础样式和共享控件 class，`src/pages.css` 提供工作区与页面组件样式，`shell.css` 管理导航与主题。应用使用自己的根 class，继承语义颜色变量，不写污染外壳的全局标签规则。所有页面随 Web 主题切换，不加载 CDN 或远程字体。

`Workspace` 提供侧栏/主区，`WorkspaceHeader.statusTone` 由应用明确传入；`Composer.onSubmit` 是普通回调。应用负责草稿、loading、错误与显式重试。主要动作和待决定事项清晰，手机无横向滚动；浏览器验证 1440×900、1024×768、390×844。

详见 [可执行页面合同](web-executable-components.md)、[应用设置](application-settings.md)、[随 Web 交付的开发指南](../../packages/engine/src/modules/steward/external/web/UI-DEVELOPMENT.md)。源码、测试、隔离验收、实际部署及真实使用分别报告；本次源码迁移不证明任何运行部署已更新。
