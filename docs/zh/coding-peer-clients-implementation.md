# Coding 统一业务服务与平级客户端实施记录

日期：2026-11-09。**实施总体验收：PASS（隔离范围）；随后已获授权部署到本地 3112，详见文末。** 本文区分已批准方向、源码现状和验收结果；源码中已有分支不代表检查通过。架构依据为已批准的 [统一方案](coding-editor-unified-architecture.md)，命令说明见 [客户端协议](coding-peer-clients-protocol.md)。

## 应用边界

恢复两个普通可选应用：无界面的 `coding` 业务服务，以及负责页面呈现的 `coding-web`。Web、仓库外编辑器及未来 Electron 是平级客户端，消费同一 Coding 应用协议。Electron、本仓库之外的编辑器修改和旧 Editor URL 兼容不在此次范围内。该次验收时 `mind`、`editor`、`remind` 暂停并保留源码。后续经用户批准，旧 Editor 应用已退役并移除；当前仅 `mind`、`remind` 整应用暂停并保留源码，见[退役记录](editor-retirement.md)。下列验收计数、产物散列和 3112 部署记录是退役清理前的证据，不作为本轮清理的验证或部署结果。

Coding 持有项目关联、默认项目、持续对话、轮次、请求回执和成果。各客户端持有自己的项目/对话选择、草稿、分页和事件游标；客户端选择不是共享业务状态。关闭页面、移除 `coding-web` 或断开 HTTP 均不隐式停止执行，只有显式停止命令改变业务状态。旧 DAG、截止时间和周期编排不接入当前命令入口。

永久内核保持 **32 个工具、5 个命名空间**（`modules`、`approvals`、`settings`、`secrets`、`activity`），本项不增加内核 API。Agent 仍是独立应用；项目和执行接口属于 Agent 应用合同，真实主机路径检查由可信主机实现负责。

## 源码与验证

源码目录为 [`external/coding`](../../packages/engine/src/modules/steward/external/coding) 和 [`external/coding-web`](../../packages/engine/src/modules/steward/external/coding-web)。下表结合当前源码与隔离检查；发行包冒烟和全量结果单独列在验收记录。

| 部分 | 已见源码 | 验收状态 |
| --- | --- | --- |
| 共同业务入口 | `coding.command` 与 `POST /api/coding/v1/commands` 均调用 `handleCodingCommand`；HTTP 经 `chrona.serve` 注册 | PASS：生产 Hono、SDK、Agent 和主机注册链路，首次 HTTP 不预热 |
| Agent 项目 | `create` 只传 `name`，`register` 只传 `path`；严格校验带 `action`、`principal` 的结果 | PASS：真实原始模块主体、名称/路径边界和执行衔接（执行器为假实现） |
| 持续对话 | 当前轮身份、停止确认、显式重试、所属关系检查已在处理函数中 | PASS：两个平级客户端、同键重放/改参冲突、重启与显式恢复 |
| 本地回执原子接受 | `conversations.create`、`projects.default` 将业务状态与 accepted 回执放在同一次日志替换；日志写入含文件/目录同步 | PASS：状态与回执单次替换；模拟落盘中断和丢回包 |
| 答复未准入 | Agent 有严格 `accepted:false` 联合分支；Coding 区分明确拒绝和未知结果 | PASS：未消耗命令的确定拒绝、已消耗重放、未知投递保持 pending |
| 有界输出 | 事件默认/上限 100；230 KiB 编码预算保护与成果省略标记已见源码 | PASS：完整编码预算、96 KiB 成果截断、超限事件自适应读取 |
| coding-web | 页面状态、固定命令映射、回执查询与草稿保留逻辑已存在 | PASS：真实 SDK 注册；三种视口 62 项浏览器检查 |
| 发行接入 | Coding 已移出暂停名单，两个应用都有独立 manifest | PASS：14 个离线来源、构建和真实二进制离线安装冒烟 |

## 主体与恢复语义

[`agent-projects.ts`](../../packages/engine/src/modules/steward/agent-projects.ts) 要求实时原始调用来自当前已批准、满足 owner 准入条件的模块，但交给主机的主体仍是 `{workspaceId,ownerId:"owner",caller:{kind:"module",moduleId,hash}}`。`ownerId` 是作用域字段，不把 Coding 转换成 owner caller。项目引用与后续执行必须保持同一原始 Coding module principal；页面参数、回调参数或任务文本都不能提供主体或执行 cwd。

请求键固定命令身份：同键同参只读原回执，改参返回冲突。未知外部结果保留 `pending`，查询、刷新和重新连接不自动重发；`round.retry` 是显式恢复动作。新一轮要求真实终态及 `stopConfirmed`，未知停止不能释放约束或推进轮次。接受成果只记录接受，不自动 Git 提交、合并或发布。

## 当前差异

- **应用权限已对齐。** Coding 与 coding-web 的当前 manifest 声明经治理的 owner 权限 `uses:["*"]`，所有业务调用仍通过真实当前模块身份进行准入；没有修改内核可见性规则，也不把 Coding 的执行主体提升为 owner。
- HTTP 启动需等 SDK 的 Unix HTTP socket 接受连接，控制通道连接不代表 HTTP 已就绪；等待不发业务请求，并在返回前复核当前激活身份。
- Web 模板的布尔 `$cond` 用作 `visible` 时会转换成公开可见性条件，混合问题列表中的 confirm/select/input/editor 各自只呈现对应控件。
- 准备阶段已知拒绝先持久化 rejected 回执；外部执行未知异常保持 pending。Web 遇到超大事件页按 100→25→5→1 缩小，并保留已知视图及省略标记。

## 验收记录

以下结果对应 2026-11-09 当前未提交开发树；既有预览服务未更新。

| 记录字段 | 当前值 |
| --- | --- |
| 实施总体验收 | PASS：源码、真实 SDK/HTTP、离线发行包与浏览器隔离验收；未部署 |
| 检查结果（命令、退出码、通过/失败/跳过数量） | Bun 196 文件最终成功结果合计 2205 pass、7 skip（含工作台定向复验）；新增服务冷启动回归 1 pass，共 197 文件、2206 pass、7 skip。边界 4 项另行复验通过 |
| 本地回执原子接受 | PASS：域测试模拟落盘中断、丢回包与同键重放 |
| 普通客户端真实路由 | PASS：生产 API 与真实 SDK 3 项、126 个断言；仅模型执行器替身 |
| 多客户端与认证 HTTP 一致性 | PASS；全量 API 117 pass、2 skip、0 fail，22 个文件 |
| 事件及完整编码输出边界 | PASS：转义、封装、base64 与超大页降级回归 |
| 离线来源数量与发行打包 | PASS：14 个来源，Linux x64 构建退出 0 |
| 隔离浏览器/冒烟结果 | 浏览器 62 pass / 0 fail，sourceDrift=[]；发行二进制冒烟退出 0，无模型请求 |
| 最终源码版本与检查对应关系 | 当前未提交开发树；源码与产物摘要见下方证据 |

验收范围限新建临时数据和假执行器等隔离材料；真实部署、真实模型、用户真实数据、真实网络服务及外部编辑器均未验证。此记录不表示发生部署或自动 Git 提交。

## 检查证据

- 全量 Bun：`/tmp/chrona-coding-full-bun-final.log`。该批次的旧工作台断言失败并自动重试两次，不能将重复结果累加；修正后 `/tmp/chrona-coding-workbench-repaired.log` 为 36 pass、0 fail。196 个文件按最终成功结果合计 2205 pass、7 skip；新增服务冷启动回归另计。
- 旧导出测试原复用固定数据库，多次运行积累约 770 MiB；改成每次独立 OS 临时库并清理。原超时子进程终止后，官方检查器重试得到 34 pass。原固定测试数据库未删除。
- 服务初始化回归及私有边界：`/tmp/chrona-coding-bootstrap.log`，5 pass；Agent 私有回调在服务初始化注册，不依赖首次模型操作，不增加公开发现或调用权限。
- 静态检查：`bun scripts/chrona.ts check all`；`/tmp/chrona-coding-static-complete.log`。原有依赖警告保留，未放宽规则。
- 生产 API：`bun scripts/run-api-tests.ts`；`/tmp/chrona-coding-full-api-final.log`。
- 浏览器：`.tmp/coding-peer-clients/browser/run-1794194289/report.json`，62 pass、0 fail，`sourceDrift=[]`。1440×900、1024×768、390×844；真实 Web/Coding/coding-web SDK 与页面，Agent/内核路由使用离线替身。生产准入链路由 API 测试另行覆盖。
- 发行包构建：`.tmp/kernel-permanent-boundary/final-build.sh`；`/tmp/chrona-coding-final-build.log`，退出 0；14 个离线 Git 来源。
- 发行二进制验收：`.tmp/coding-peer-clients/release-smoke.ts`；`/tmp/chrona-coding-release-smoke.log`。新建临时数据、离线安装、真实认证 HTTP/Agent 项目主机，无模型请求。脚本按 `open` 审批且要求非空激活哈希；不能把配置 active 当成已激活。

最终发行二进制 SHA-256：`0b8f1dd33a33259aa2198e00a41f3c3e3046448faa2500d3db239e8a5bb6836b`。基准 HEAD 为 `cf19ceb704800e5c53e0784aff4558883f6afa9b`，实现位于未提交开发树，不表示该 HEAD 自身包含这些变更。构建成功后，仅补充文档和测试记录；发行包冒烟退出 0，静态检查退出 0（33 个既有依赖警告，0 错误）。

最后一次全量 API 复验：117 pass、2 skip、0 fail，`FULL_API_EXIT=0`；发行包 `SMOKE_EXIT=0`。`git diff --check` 无输出。全量 Bun 原批次退出 1 的原因及后续定向通过记录保留如上，未把失败批次改写成退出 0。

## 本地预览部署

2026-11-09 用户另行授权部署后，已更新 `chrona-kernel-preview.service`（`127.0.0.1:3112`），运行二进制 SHA-256 与上述验收产物一致。原数据目录与 `service.env` 保留，停服冷备份位于 `.tmp/kernel-minimization/local-deploy/rollback-coding-20261109T042650Z`（包含配置、数据与旧发行包）。`3111` 实例未修改。

通过停止服务的受检安装器安装 Coding/coding-web，并只批准本次两个应用的激活请求。线上验证：两个应用均具有非空激活哈希，页面已注册；认证项目和对话读取成功，无密钥/错误密钥为 401；MCP 初始化、24 工具和模块读取正常；内核仍为 5 命名空间、32 工具；Pi 可用，原模型配置保留。未在既有数据中创建验收项目/对话，未调用模型。部署结果：`.tmp/coding-peer-clients/local-deployment.json`。
