# 模块依赖方向审查

状态：2026-11-02 审查记录，问题清单已与用户确认。2026-11-03：第 1–5 项已实现（0.9.x 部署），第 6 项按用户选定方向经构建会话处理中。

## 1. 原则

**依赖只能从具体指向通用。** 通用模块（web、notify、chat、schedules、memory、mind、Provider）不认识任何具体应用；具体应用可以认识并调用通用模块。

模块之间仍只有 call 与 callback 两种方式（v2-8），主动与被动由依赖方向决定：

| 关系 | 主动方 | 被动方 |
| --- | --- | --- |
| 具体应用使用通用能力 | 应用调用 | 通用模块提供工具 |
| 通用模块呈现、汇总具体应用 | 应用调用通用模块的登记工具，提供自己的数据或描述 | 通用模块只按统一规则使用；只回调应用自己点名的工具 |
| 应用之间 | 用到对方的一方调用；"我变了，谁关心谁处理"用事件 | 被调用方提供工具或发出事件 |

检验：**新增一个应用时，这里要不要改？** 要改的一方知道得太多。

## 2. 问题清单

依据：内置模块 manifest、内核代码中硬编码的模块名、各自定义模块最近一次获批版本的调用声明（2026-11-02）。web 定制版源码未逐行审查，其专页依据审批记录推断。

### 2.1 倒置：通用模块认识具体应用

| # | 位置 | 现状 | 方向 |
| --- | --- | --- | --- |
| 1 | web → 各应用 | 定制版 web 内置 OKX、planning、Trending、gmail、bookmarks、calendar、mail 专页，硬编码如 `okx-ai-trader.list/get/audit` 与字段投影；与这些应用多次联合构建 | 应用向 web 登记页面，web 统一渲染（第 4 节） |
| 2 | notify → qq | `builtin/notify/notify.ts` 硬编码 `QQ = "chrona_qqbot"`、`callPort("qq.deliver")`；manifest `uses: qq.deliver`，`channel` 的 `callers: [qq]` | 渠道调用 `notify.channel` 登记自己的投递工具，notify 只回调已登记渠道。状态：内置 notify/qq 已实现按真实调用方幂等登记并校验回调权限，兼容 `chrona_qqbot` 旧队列；无已登记且就绪的渠道时照旧退到网页（in_app）。线上定制版 notify/qq 的功能（Markdown 格式、schema 2、QQ 高风险审批提示）已并入内置版，用 `chrona admin rollback <m> builtin` 替换定制版；为此定制模块在发版时也构建当前内置版并标为已批准、不启用。 |
| 3 | 内核 → 入口名单 | `today.ts`、`memory.ts`、`chat.ts` 写死 `["web","qq","mcp"]`；`owner-build.ts` 只允许 `mcp`、`web`；memory 系统工具 `callers: ["web","mcp"]` | 用已有的 `isEntryModule(manifest)` 判断入口，不按名字。状态：today、会话轮换与 memory 已改用入口 manifest 和会话入口归属；运行时审批已按 security-simplification.md 改为所有入口均可批准或拒绝；`owner-build` 名单仍保留。 |
| 4 | 内核 → remind / mind / web | `schedules.ts`、`module-builtin.ts` 特判 `remind`；`tick.ts` 只给名为 `mind` 的模块附加 `MIND_PROTOCOL`；`chat.ts` 回填 `web` 会话；reflection prompt 点名 web | remind 改用 v2-24 通用定时器（先确认提醒数据迁移）；协议由 mind 在 `provider.wake` 时自带；删除迁移残留。状态：内置 mind 自带协议正文，沿用不可信模块数据通道，内核不再按名附加系统协议；reflection 按入口描述选择页面登记目标，不再点名 web；chat 回填保留，因 0015 迁移只新增空的 entryModuleId，旧会话仍依赖回填恢复回复路由。remind 改为普通应用：提供 `create/list/cancel` 工具、用 v2-24 模块定时器（`schedules.create`），Agent 用 `m_remind_create`；`chrona_schedule` 只剩 `wake`；0018 迁移把已有提醒的 `text` 改为计时键 `legacy-<id>`（提醒文字仍在 payload）；内核删除 remind 特判与回填，`dynamicSchedules` 仅为解析旧 manifest 保留、不再生效。 |

### 2.2 方向正确，但以名单写死调用方

| # | 现状 | 问题 | 方向 |
| --- | --- | --- | --- |
| 5 | 应用工具 `callers` 写成"仅 web、mcp"（mail、calendar）或"仅 web"（gmail、bookmarks） | 应用须列举入口；gmail、bookmarks 的工具 MCP 与 Agent 用不了，违背"用户与 Agent 用同一套功能"；新增入口要改所有应用 | 用 `visibility: owner` 表示所有用户入口可调用。状态：随第 1 项迁移完成；2026-11-03 线上仅 bookmarks 仍有 `callers:[web]`，其迁移构建进行中 |

### 2.3 正确范例（保留、推广）

- mind 的 `attention`：应用以 `contributes.mind.attention` 声明工具，mind 经 `modules.contributions` 统一发现，不认识具体应用。
- events、memory（`contributes.memory`）、v2-23 应用设置。
- 应用调用 `notify.send`、`schedules.*`、`provider.complete`、`secrets.*`。
- web、mcp 的 `uses: ["*"]` 作为通用透传入口本身没有问题。

### 2.4 同层依赖，待定方向

| # | 现状 | 待定 |
| --- | --- | --- |
| 6 | `calendar → planning.get` | 用户选定：planning 经 events 发出 `planning.updated`，calendar 订阅并在本地保存计划标题，删除 `uses: planning.get`（构建会话） |

## 3. 处理顺序

1. web（第 1 项）作为范例先做。
2. 第 3、5 项：入口成为通用概念。
3. 第 2 项：按 web 的登记模式改 notify 渠道。
4. 第 4、6 项穿插处理；第 6 项先定方向。

## 4. web：应用登记页面（规格草案）

状态：2026-11-02 用户确认方向；第 1–2 步已在仓库实现并本地验证（见 4.9），未提交、未部署。

### 4.1 原则

- 只用 call / callback（v2-8），不新增交互方式。应用调用 web 的登记工具；web 不认识任何具体应用。
- **结构推送，数据现读**：应用推送页面结构与所用工具的引用；业务数据不推送、不在 web 留副本，用户打开页面时 web 回调登记方的读取工具。小型摘要可推送快照。
- **推送的是引用，不是工具**：工具仍在应用进程中执行、随应用版本与回滚。引用只能指向登记方自己的工具，web 自动补模块名。
- **告知，不是授权**：web 作为用户入口本来就能调用 `visibility: owner` 的工具；登记只让 web 知道用哪个、怎么用。敏感动作仍由工具自己发起 `approvals.request`。应用工具不再需要 `callers: [web, mcp]` 名单（第 5 项）。
- web 掌握组件目录，风格与操作习惯由此统一。

### 4.2 UI 格式：json-render

采用 [json-render](https://json-render.dev/)（Vercel Labs，Apache-2.0）与 `@json-render/shadcn`，与当前 web 的 React + Tailwind + shadcn 一致；组件目录即 web 的设计系统。锁定精确版本，登记记录 catalog 版本；json-render 破坏性升级时由 web 负责迁移或兼容已登记的 spec。

不选 [A2UI](https://a2ui.org/)：它是 Agent 到客户端的流式 UI 协议，适合对话中边生成边推的界面，可留给日后 Provider 对话中的生成式界面。

### 4.3 web 工具

| 工具 | 调用方 | 作用 |
| --- | --- | --- |
| `page-set({ id, title, data?, spec })` | 任何模块 | 登记或替换自己的一个页面；幂等，按 内核记录的调用方 + `id` 归属 |
| `page-remove({ id })` | 登记方 | 删除自己的页面 |
| `pages()` | 登记方 | 自己已登记的页面 |
| `catalog()` | 任何模块 | 组件与动作说明（`catalog.prompt()`）及 catalog 版本，供构建会话编写 spec |

登记示意。`data` 是 web 的约定；`call` 是 web 组件目录中的一个 json-render action，确认弹窗用 json-render 原生的 `confirm`：

```json
{
  "id": "experiments", "title": "模拟实验",
  "data": {
    "list":   { "tool": "list", "args": { "offset": 0 }, "refresh": 30 },
    "detail": { "tool": "get",  "args": { "experiment-id": { "$state": "/selected" } } }
  },
  "spec": { "root": "card", "elements": {
    "card":  { "type": "Card", "props": { "title": "模拟实验" }, "children": ["pause"] },
    "pause": { "type": "Button", "props": { "label": "暂停" }, "children": [],
               "on": { "press": { "action": "call",
                                  "params": { "tool": "pause", "args": { "experiment-id": { "$state": "/selected" } } },
                                  "confirm": { "title": "暂停实验", "message": "不会自动清仓或撤单" } } } }
  } }
}
```

`data.<key>` 的结果写入 `$state` 的 `/<key>`。shadcn 组件的数据形状固定（如 `Table.rows` 为 `string[][]`），应用可提供面向展示的读取工具，或用 json-render 的 `repeat`。

### 4.4 web 补的薄层

json-render 不提供的部分由 web 实现，只做数据与动作，**不扩展 UI 格式**（需要逻辑时改应用工具，不给格式加表达式）：

1. 数据：按 `data` 调用登记方工具，结果写入 `$state`，按 `refresh` 刷新；页面隐藏时暂停，失败保留旧值并提示。
2. `call` 动作：回调登记方工具；确认、防重复、幂等编号由 web 统一处理，依据工具元数据（`idempotent`、副作用说明）。
3. 加载、空、错误、旧数据状态统一呈现。

### 4.5 校验

`page-set` 时检查，不通过直接返回错误：

1. 引用的工具存在于登记方当前启用版本（`modules.tools`）。
2. 参数绑定符合工具参数 schema。
3. spec 只用组件目录内的组件与动作，props 符合其 zod schema。

`catalog.validate(spec)` 只校验结构（root、elements、children），**不校验组件类型、props 与 action 名**（4.8 实测），因此第 3 条由 web 自己逐元素检查：`type` 在目录内、字面 props 通过该组件的 zod schema（`$state` 等动态值跳过）、`on.*.action` 在目录内、`call` 的 `tool` 是登记方工具。

构建测试使用假内核，没有 web 校验。`catalog.jsonSchema()` 仅 19 个节点、深度 7，可作为 `page-set` 的参数 schema（远低于 P2 上限），但它对 props 放开，路由只能粗校验；细校验仍在 web 运行时返回错误。

### 4.6 生命周期

- 应用每次启动时重新登记（幂等），回滚即恢复旧页面。
- 应用停用或删除后 web 不显示其页面；删除时清除登记。
- 未登记页面的应用继续使用通用工具页兜底。

### 4.7 迁移顺序

1. web 实现登记工具、薄层与校验；保留现有专页。
2. bookmarks 登记页面，验证格式（最简单）。
3. OKX 登记页面做压力测试（轮询、确认、revision 绑定、单次开始审批）。
4. 其余专页（planning、Trending、gmail、calendar、mail）逐个迁移，迁移后从 web 删除对应专页代码与 `callers` 名单。

线上 web 是用户/AI 定制版（React，已近 1 MiB 上限），不在其上修改：新 web 即仓库内置 `web`，随 Chrona 发版后用 `chrona admin rollback web builtin` 切换，定制版已批准版本保留可切回。切换后，定制版里各应用的专页在该应用登记页面前退回通用工具页。

### 4.8 json-render 试用记录（2026-11-02，离线）

`@json-render/core`、`@json-render/react`、`@json-render/shadcn` 0.21.4，React 19，zod 4：

- shadcn 目录 36 个组件：Card、Stack、Grid、Separator、Tabs、Accordion、Collapsible、Dialog、Drawer、Carousel、Table、Heading、Text、Image、Avatar、Badge、Alert、Progress、Skeleton、Spinner、Tooltip、Popover、Input、Textarea、Select、Checkbox、Radio、Switch、Slider、Button、Link、DropdownMenu、Toggle、ToggleGroup、ButtonGroup、Pagination。
- `defineCatalog(schema, { components: shadcnComponentDefinitions, actions: { call } })` 可用；`catalog.prompt()` 约 23.7k 字符，可作 `web.catalog` 的返回。
- 上方示例 spec 通过 `catalog.validate`；未知组件被拒绝；**props 类型错误、未知 action 未被拒绝**。
- `ActionBinding` 原生支持 `params`（含 `$state`）、`confirm`、`onSuccess`、`onError`。
- 未验证：React 渲染、`call` handler 与状态刷新的实际行为、与定制 web 构建链的集成。

### 4.9 实现记录（2026-11-02，未提交、未部署）

开发范围按用户要求只含 web 与试点 files，其他模块未改；验证通过后再逐个迁移。

- **内核 `activated` 事件**（用户选定）：manifest `activated: true` 的模块在每个启用版本收到一次 `on("activated")`，其 `uses` 中的模块换版本时再收到一次（签名 = 自身 hash + 依赖 hash，记于 `platform/activated.json`；投递失败重试至多 3 次）。SDK 对未处理的 `activated` 直接回复，不算故障。用于休眠应用登记页面，也适用于其他需在启用时向通用模块登记的场景。改动：契约事件与 manifest 字段、SDK、`module-supervisor.ts`。
- **web**：`page-set/page-remove/pages/catalog` 工具（含 output 契约）、`pages.ts` 登记与逐元素校验、`/api/web/pages` 路由；`catalog.ts` 为 shadcn 定义中 web 已实现的 20 个组件加 `Markdown`、仅以本应用内容引用（支持 `$state`/`$template`）经同源认证路由读取 PNG/JPEG/GIF/WebP 的 `Image` 与 `call`；`src/pages.tsx` 用 `style.css` 风格实现组件、数据读取（`needs` 为空时跳过、`refresh`、失败按来源清除）、`call`（`keyed` 工具自动 request-key、失败抛出以走 `onError`）；导航与应用详情按登记列出页面；删除写死的 `/files` 文档页。
- **files**：`activated` 时登记文档页（`page.ts`），web 不支持时只记日志；`list` 增加 `dir`、`parent` 与条目 `path`。
- **发现的 json-render 行为**：action 顶层参数中 `$item` 解析为状态路径，取值用 `$template`；`defineRegistry` 组件拿不到 `element`；确认弹窗为内联白色样式（`style.css` 覆盖）；`catalog.validate` 不查组件/props/action（web 自查）；页面加载时 CSP 报告一次 `script-src` 回退（zod 探测 `new Function`，已被捕获，不影响功能）。
- **验证**：web、files 模块测试；内核模块类型检查（web、files 入口 0 错误）；`src` tsc；引擎 + 集成 Steward 测试 706 通过、0 失败；全仓 tsc 0 错误；`git diff --check`。只含 web + files 的本地 harness（真实 files 逻辑、真实 page-set）中用 Chromium 实测浏览、Markdown、编辑预览与保存、确认后删除至 .trash、返回上级、`.trash` 隐藏、应用详情链接、今天页；1280 明/暗与 390 移动宽度无横向溢出。
- **端到端**（源码服务，临时数据目录，无 Provider、无 QQ 凭据）：内置 web 经真实依赖安装、类型检查、测试与 smoke 后启用；files 首次收到 `activated` 时 web 尚未启用，登记失败只记日志；web 启用后 files 的依赖签名变化，内核再次投递，登记成功（约 15 秒内）。浏览器中导航出现"文档"，浏览、打开、确认后删除均正常。
- **端到端发现并修复**：构建 smoke 会不带 caller 调用每个工具，页面工具原先因此报错使 web 版本被拒；现与 `events` 一致，无 caller 时返回 `ignored`。另：源码服务中内置版本被拒时，服务日志没有任何记录、状态停在 `testing`（15 分钟后才恢复），属既有可观测性问题，未改。
- **未验证**：chino 部署与 `chrona admin rollback web builtin` 切换、其他应用迁移。

## 5. 后续迁移（交给 Pi）

阶段性结束：web 与 files 完成，其余由 Pi 迁移。每个应用一次独立任务，范围只含该应用与 web 中对应专页的删除。

**每个应用的步骤**

1. 读该应用当前启用版本与 web 定制版中它的专页（`artifacts/module-pages/live/web/src/pages/*.tsx` 与 `index.ts` 中对应路由），列出页面必须保留的读取、操作与确认。
2. 应用 manifest 加 `"activated": true`、`uses` 加 `"web.page-set"`；入口加 `on("activated")` 调用 `web.page-set`，失败只记日志（参照 `builtin/files/index.ts`、`page.ts`）。
3. 页面只用 `web.catalog` 返回的组件与规则；读取放 `data`，修改用 `call`，改动数据的操作加中文 `confirm`。需要展示形状时由应用提供或调整自己的读取工具（files 的 `list` 补 `path/parent` 即先例），不要让 web 理解应用数据。
4. 工具 `callers: ["web", ...]` 改为 `visibility` 含 `owner`（第 5 项）。
5. 测试：模块测试中发送 `activated` 事件并断言 `web.page-set` 参数；用 web 的 `pageErrors` 校验 spec 为空；有条件时在只含 web + 该应用的 harness 中用浏览器走一遍主要操作。
6. 迁移后从 web 删除该应用专页与路由。

**已知坑**（4.8、4.9）：action 顶层参数 `$item` 是状态路径，取值用 `$template`；`Button.variant` 只有 primary/secondary/danger；确认按钮默认英文，需写 `confirmLabel/cancelLabel`；缺必填参数的数据源不会读取；`{error}` 结果按失败显示。

**顺序建议**：bookmarks（简单，验证流程）→ calendar、planning（同时定第 6 项方向）→ gmail、mail → Trending、image-generation → OKX（轮询、revision、单次开始审批）。之后处理第 2–5 项（notify 渠道、入口名单、内核特判）。定制应用需经构建会话修改并由用户审批；内置部分可直接改仓库。
