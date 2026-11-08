# 连续编码工作台开发验证

日期：2026-11-08。范围：用户批准的 Chrona 本机连续编码工作台。状态：开发集成与受控验证完成；未部署、未推送、未使用真实模型或真实账户执行项目任务。使用说明见[编码工作台](coding-web-workbench.md)，范围依据见[实现前评估](coding-workbench-implementation-assessment.md)。

## 实现与提交

| 提交 | 交付 |
| --- | --- |
| `4a898f4` | 路线、范围评估、参考研究和已认可的交互原型 |
| `7e9e483` | 持久本机项目登记、执行续接契约、Provider 会话恢复校验、按 attempt 保留差异 |
| `588668e` | Agent 发行文件纳入续接与 Pi 上下文检查 |
| `b1922a6` | 共享 Workspace、ScrollArea、Message、CodeDiff、ActionOption 与命名槽验证 |
| `18fcde7` | 在数据库事务中保存当前轮次引用，去掉依赖时钟和随机编号的续接判断 |
| `b16e4bc` | 项目选项标签与真实引用分离、表单禁用状态和对应渲染产物 |
| `db4e39b` | 持久连续对话、轻量页面、事件缓存与分页、问答、精确重试及拒绝恢复 |

沿用 coding → Agent → 现有执行治理。每轮新建 Run/Attempt 和预算，复用同一受检 Provider 上下文；未添加第二套队列，也没有让页面读取 Pi 会话文件。

## 自动检查

在临时数据库、临时数据目录和临时项目下运行；没有连接真实账号或模型。

- 主要受影响回归：**203 通过、6 跳过、0 失败，1,244 次断言**。覆盖项目登记与作用域、续接身份/当前轮次/停止证据、上下文恢复、前轮差异保留、编码作者测试、对话恢复与共享页面契约、Pi 文件/RPC 校验。
- 其中 coding 会话与作者用例在修复后单独检查为 **21 通过、391 次断言**；包含发送与完成竞争、问题过期、消费过的控制回执、明确拒绝与不明确结果、停止请求重放、空/带空白原生答复、首次生命周期快照、长回复分页与去重。
- 实际 SDK/SQLite/受控 Pi 子进程的 `execution-workbench.bun.test.ts`：另有 **4 通过、117 次断言**，涵盖 snapshot 项目执行、问答、成果和停止/恢复边界。
- 仓库 TypeScript 检查通过；本次 39 个相关 TypeScript 文件的 ESLint 通过；`git diff --check` 通过。
- 全量 lint ratchet 仍因改动前已有的 **34 条警告、0 条错误**拒绝通过，位置在原有 agent-context、agent-primitives、入口应用会话等文件；此次改动未增加这些文件的警告。没有放宽 lint 规则或改写基线。
- 依赖边界检查报告 **0 错误、23 条已有测试导入警告**。
- 重新生成 execution 契约、Agent 发行文件与 web 页面 bundle；生成文件随实现提交。

复查命令使用 `NODE_ENV=test`，并为每次 Bun 测试设置新的 `DATABASE_URL=file:<临时目录>/test.db`、`CHRONA_DATA_DIR=<临时目录>/data`。主要测试位置：

- `apps/server/src/config/execution-project-registry.bun.test.ts`
- `packages/engine/src/modules/steward/system/projects.bun.test.ts`
- `packages/engine/src/modules/steward/execution-continuation.bun.test.ts`
- `packages/engine/src/modules/steward/execution-context.bun.test.ts`
- `packages/engine/src/modules/steward/execution-result.bun.test.ts`
- `packages/engine/src/modules/steward/coding-workbench.bun.test.ts`
- `packages/engine/src/modules/steward/coding-author.bun.test.ts`
- `packages/integrations/src/steward/pi-session-resume.bun.test.ts`
- `packages/integrations/src/steward/pi-provider.bun.test.ts`
- `packages/engine/src/modules/steward/builtin/web/src/workspace.bun.test.tsx`
- `packages/engine/src/modules/steward/builtin/web/workspace-catalog.bun.test.ts`
- `apps/server/src/__tests__/api/execution-workbench.bun.test.ts`

## 浏览器检查

在 Chromium 中加载实际 coding.PAGE 和共享 web 渲染器，动作调用真实 coding 工作台处理函数；在 Agent/projects 边界使用受控响应，不连接运行中的个人服务。这验证页面与业务处理之间的交互，不冒充真实模型端到端验收。

| 尺寸 | 观察结果 | 留存图 |
| --- | --- | --- |
| 1440×900 | 无横向溢出；列表和消息区独立滚动；输入区保持可见；完成后可继续输入 | [桌面](../validation/coding-workbench/desktop.png) |
| 1024×768 | 相同布局断言通过；长回复可滚动，输入区可用 | [平板](../validation/coding-workbench/tablet.png) |
| 390×844 | 列表/主区切换；无横向溢出；消息可滚动；输入区可见 | [手机](../validation/coding-workbench/mobile.png) |

另以真实页面操作验证：添加目录、按标签选择实际项目引用、保存用户消息、原生确认与选择答复、轮询保留草稿、完整示例回复、下一轮携带 resumeFrom、停止待确认禁用发送、实际停止后重新开放输入、刷新恢复对话。三种尺寸均走完此流程；视觉修正后的手机检查确认消息视口高 440px、内容高 1,249px、输入框下边缘约 758px，没有页面错误。

浏览器联调发现并修复了单元检查未暴露的三处集成问题：ScrollArea 被额外容器包裹后高度为零；重复项自身的属性取不到 item 上下文；项目下拉选项把标签和引用混为一值。修复后才留存以上截图。

## 后续与限制

- 真实模型跨轮上下文、实际项目编辑和个人环境长时间运行尚未验证。下一步应在明确授权的隔离项目做两轮编码和停止/返回检查。
- 新页面使用 v1 本机目录路径；未宣称 v2 设备、独立工作树、父子工作和所有入口的完整对话接续已验收。
- 差异与消息只对实际捕获/读取内容作完整性声明；snapshot 基线不是文件备份。旧静态项目配置不会自动变成页面列表，项目删除和克隆不在当前页面范围。
- Session 增加内部 `executionHeadAttemptId`。按仓库发布前规则修改 `0001_initial` 基线并重新生成 Prisma；检查全部使用新数据库，未对现有个人数据库运行迁移。已有数据库升级需要独立发布/迁移任务，不应绕过迁移校验直接启动。

## 原型视觉修正与复核

首次交付只验证了交互与尺寸，未核对已认可原型的视觉一致性；因此这些检查没有发现页面退化为大表单的问题。本次重新对照 `docs/prototypes/coding-workbench/index.html` 和截图，实际页面补齐窄导航栏、272px 桌面侧栏、白色交流区、24px 标题、无外框消息、交流/成果页签、紧凑问题选项和固定输入区。桌面发送保留列表，手机选择对话后进入主区。当前留存图已替换为修正后的实际组件截图，示例执行标识明确显示在右上角；[问题状态](../validation/coding-workbench/question.png)另行留存。

这些调整位于共享 web 组件和 coding 页面定义，继续使用真实页面处理函数。当前对话的项目路径独立显示，项目选择器明确只用于新对话；成果页同样提供停止操作。Enter 发送、Shift+Enter 换行，输入法组合期间不会发送。完成后继续输入、直接编辑与无成果接受门槛的行为保留。

本轮定向检查为 **25 通过、440 次断言、0 失败**，TypeScript 与修改文件 ESLint 通过；正式生成的 `pages.js` 另跑桌面完整交互检查。共享组件在 1440×900、1024×768、390×844 与手机深色模式检查草稿、焦点、光标、滚动和键盘；实际页面三种宽度检查原生问题、持续对话、成果页停止及刷新恢复。截图采用受控示例数据，无真实项目或模型执行。
