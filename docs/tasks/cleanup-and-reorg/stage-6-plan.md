# 阶段 6：职责与目录

基准 `694f2d9d`，开始时工作树和 index 干净。仅本地宿主源码与文档；不改公开合同、应用版本、依赖锁、数据库或部署。采用 ponytail/full 与 antislop during（session override）；不改 UI。当前工具没有 Serena/Hindsight，使用 TypeScript AST、rg 和实际消费者核对。

## 目标目录树（实施前记录）

```text
packages/engine/src/modules/steward/
  agent/          # 通用 Agent 上下文、Provider 登记与结算；同名测试随消费者迁移
  execution/      # Run 准入、占用、交付、停止与事件；同名测试和 fixture
  modules/        # 普通应用注册、材料、构建、授权、调用与生命周期；同名测试和 fixture
    module-build.ts         # 不可变材料检查、测试、安装及构建认领
    module-build-review.ts  # 预览、精确审批、自动激活与原版本恢复
  applications/   # 固定输入恢复的私有 staging，位置不变
  entry-app/      # 既有会话存储，不改变归属
  system/         # 七命名空间路由，不改变公开入口
  __testing__/    # 跨模块状态机反例
  index.ts        # 既有公开入口
  ports.ts / service.ts / tick.ts / … # 组合与其他内聚 kernel 服务
packages/integrations/src/steward/
  runtime/        # 宿主资源定位、进程运行、环境与实际停止；相应测试
  packages/       # 宿主依赖安装；相应测试
  module-sdk/     # 原 SDK 资源路径，保持应用构建消费者稳定
  module-typecheck/ # 原类型检查资源路径
  runtimes.json   # 原发行资源位置
  index.ts       # 既有公开入口
```

只移动职责可按文件前缀确定的生产实现及其测试；业务应用不为行数阈值重构。所有导入、动态入口、资源相对路径、构建/测试/架构检查消费者同步。路径搬迁单列，不算功能删减；不保留空转发文件。

## 候选和保留例外

300 行仅用于发现。统计分别报告宿主与固定应用输入，生产手写、测试、生成代码分列；生成副本继续归应用。初次物理行扫描发现的宿主候选如下。

| 候选 | 原行数 | 处理与理由 |
| --- | ---: | --- |
| `module-build.ts` | 415 | 拆分构建检查与审批/恢复；二者消费者和依赖不同。保持事务、顺序、授权与失败处理代码原样。 |
| `module-supervisor.ts` | 591 | 迁入 modules，保留一个持有实例/投递/停止状态的 supervisor；不引入第二套对象或 hook。 |
| `module-calls.ts` | 433 | 迁入 modules；同步调用、异步队列共享身份、幂等绑定和结算，已有 target/output/admission/state 文件，暂不额外拆状态机。 |
| `module-install.ts` | 334 | 迁入 modules；固定输入安装事务与精确恢复内聚，保留。 |
| `entry-app/conversations.ts` | 495 | 单一会话存储实现，摘要与详情查询共享格式/身份规则，保留。 |
| `packages/contracts/src/steward/index.ts` | 429 | 公开合同入口由协调者拥有，本阶段不改。 |
| `packages/db/src/sqlite-backup.ts` | 360 | 完整备份与恢复校验同属 SQLite 运维，不扩阶段 8。 |
| `packages/pi/src/pi-provider.ts` | 433 | Provider 进程协议与实际停止内聚，本阶段不更改适配器。 |
| `scripts/check-guardrails.ts` | 503 | 检查注册/选择与 CLI 入口内聚，仅同步新职责目录匹配，不拆通用框架。 |

## 验证与停止条件

先保存 Bun/API 发现清单，迁移后一一映射，不能减少断言和测试。lint 使用真实旧新路径映射读取固定基准源码，不授予债务豁免；新增文件不得借搬迁增加债务。先定向，再串行完整 `verify:slice`、全 Bun/API、native build/smoke、既有 Web 与设置三尺寸。检查继承 PATH/Prisma engine，固定 `LINT_RATCHET_BASE=694f2d9d`、`CHRONA_TEST_CONCURRENCY=2`，systemd 限制 8G/1G、Node 6144 MiB。保留失败轮次与退出码；若限时前未结束，交付准确 unit/PID/结果路径，不称完成。不运行真实模型、QQ、真实账号/DB，不运行 Nix/Docker 完整包或部署。独立 reviewer 由父会话安排。

## 固定应用候选（完整分类后补充）

以下为应用自有手写实现；本阶段仅更新宿主集成测试导入并在独立仓库提交/pin，不改业务实现。各文件超过 300 行的原因与保留职责如下。

| 文件 | 行数 | 保留职责 |
| --- | ---: | --- |
| `author/files.ts` | 343 | 有界文件导入/导出与材料校验，属于 Author 私有文件 API。 |
| `chat/state.ts` | 363 | 会话状态与并发合并共享一个存储模型。 |
| `chat/ui.ts` | 434 | Chat 页面组合；本阶段无视觉改版。 |
| `mind/core-admission.ts` | 366 | Mind 自有准入策略，公开内核授权边界不变。 |
| `mind/core-application.ts` | 361 | Mind 自有应用操作与受理流程。 |
| `mind/core-runtime.ts` | 452 | Mind 自有执行状态机，本阶段不扩大到深层状态审查。 |
| `mind/core-service.ts` | 530 | Mind 自有服务组合与持久恢复。 |
| `mind/core-sources.ts` | 421 | Mind 私有信息来源与摘要查询。 |
| `mind/core-store.ts` | 429 | Mind SQLite 私有存储，完整数据与并发语义保留。 |
| `mind/core-verification.ts` | 301 | Mind 自有验证策略。 |
| `mind/workspace-ui.tsx` | 626 | Mind 工作区 UI；本阶段无视觉改版。 |
| `notify/notify.ts` | 387 | 通知持久接收、ack 和投递完整链路。 |
| `qq/official.ts` | 307 | QQ 官方协议适配器；不调用真实账号或消息。 |
| `remote-execution/app.ts` | 491 | 保留应用的队列/停止协议，暂停政策不变。 |
| `web/index.ts` | 351 | Web 外壳登记与路由入口；本阶段不扩界面设计。 |

历史 `reports/`、`research_notes/` 与明确标为旧快照的设计/验证文档保留当时路径；当前代码消费者和架构地图使用新路径。历史材料不能因目录搬迁被改写成新版本已验收的证据。

## 独立复审修复（r3）

两份独立复审原判 BLOCK。completion settlement 仅删除未使用的 `callProviderEndpoint` 导入成员。lint 搬迁预算在旧路径仍存在于目标树时不转移给后继；`--staged` 的存在与内容取自实际 index，普通模式取工作树。新增真实临时 Git CLI 反例先证明修前错误通过，再验证修后拒绝 partial staging、完整搬迁与后续自身基准仍通过，以及 fatal 基准仍拒绝。测试清除继承 GIT_*，不访问主 index。r2 全量 slice 的 type/guardrails/252 关联测试通过而 lint 失败记录保留。r3 串行定向 CLI/lint、最终完整 slice，再执行此前未运行的全 Bun/API、native build/smoke、既有三尺寸浏览器及 lint 债务盘点；已过的无关定向检查不重跑。
