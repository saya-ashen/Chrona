# Web 可执行页面

应用通过自身 `activated` handler 的 `web.page-set` 登记普通 React / TSX 编译的页面。Web 绑定真实调用者身份、活动批准版本、页面 revision 与可供用户调用的工具合同；浏览器共享 Web 的 React runtime 和主题。

`component-set` / `component-remove` 与 JSON 页面 DSL 已移除。页面直接携带 `javascript`、可选 `css` / `props` 及 `tools`；默认导出 `mount(element,host)` 并返回清理函数或 `{destroy}`。React 与共享组件从 `/pages.js` 导入，构建时作为 external 保留。完整例子、宿主 API、构建及验证入口见 [应用页面开发指南](../../packages/engine/src/modules/steward/external/web/UI-DEVELOPMENT.md)。

`page-set` 接受 `id/title/layout?/purpose?/javascript/css?/props?/tools?/content?`。`layout` 为 `document` 或 `workspace`；`purpose: "settings"` 将页面嵌入应用详情。应用只能登记自己的页面与用户可见工具，不能通过 props 自授身份或权限。`host.call`、内容路由与源码路由核对页面 revision；工具调用继续走内核实际准入和审批。

可信应用代码在 Web 同页运行，无 iframe 或浏览器沙箱。Manifest 和路由合同不隔离同一 OS 用户的恶意代码。停用/移除后旧回调失效；同版本重新启用或回滚选择该版本登记。已经执行的浏览器代码不被远程强制终止；页面切换时调用 cleanup，释放媒体、监听器、定时器和对象 URL。

登记校验位于 `external/web/pages.ts`，浏览器加载器在 `external/web/src/page-runtime.ts`，UI 宿主在 `src/application-pages.tsx`。`registration-test.ts` 提供真实 activated handler 与真实登记校验的离线测试支持；它属于 Web 应用，不是内核新接口。不要只断言手工拼出的 page-set 参数，或用旧版本验收证明当前页面行为。
