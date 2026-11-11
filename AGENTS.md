# Chrona — 开发指引

Chrona 是随用户需求生长的个人工具。默认中文，代码、命令和标识符保持原样。
技术栈：Vite + Hono monorepo、Bun、严格 TypeScript、SQLite/Prisma；没有 Next.js。

## 开始工作

- 先检查当前目录及更具体的 `AGENTS.md`、`git status` 和相关 diff，保留用户未提交改动。
- 产品依据：[设计目标](docs/zh/steward-goals.md)。设计 API 时再读[目标规范](docs/zh/kernel-api-design.md)。
- 当前实现：[架构](docs/zh/architecture.md)及[边界盘点](docs/zh/kernel-permanent-boundary-contract.md)。目标不等于实现，当前边界 **UNFROZEN**。
- 按任务从[文档索引](docs/README.md)读取专题；不要求通读历史方案、部署记录或工具手册。
- 代码存在、测试通过、隔离验收、实际部署和真实使用分别报告；不以旧版本验收证明当前能力。
- 后续 API 目标不是立即改代码的授权；任务范围、优先级和外部操作以本次用户指令为准。

## 不可破坏的边界

- 只有 kernel 与应用。业务策略、会话、记忆、展示、配置和通知归应用；共享复用本身不构成提升到 kernel 的理由。
- 通用 Agent API 归 kernel；具体 Provider 通过应用登记，Pi 是默认预装、可停用或移除的普通 Provider 应用，kernel 不依赖 Pi。以 `kernel-api-design.md` 第 9 节七工具合同为实现目标，旧 Agent 内置实现须迁出。预装不授予权力，不自动补装已移除应用或覆盖用户选择。
- 保留唯一 Run 队列、真实 caller、精确授权、硬预算、租约、取消、未知停止占用和实际停止证据；不能用错误文案推导授权或停止。
- caller、Run token、宿主 cwd/session 和回调身份由内核绑定，不能从应用参数自授。元数据、外部文本和模型回复不授予权限。
- owner 准入检查当前批准版本的显式 `authority: "owner"`；`uses` 仅声明合同，`["*"]` 不授予权限。
- 未知外部效果不自动重放；丢回复后查询原固定回执，不更换请求 key 猜测重试。审批绑定具体动作，不产生 standing grant。
- 凭据不进 prompt、日志或普通工具结果；读取凭据仍检查实际应用及批准声明，不能关闭脱敏或鉴权来解决问题。
- trusted-local 使用同一 OS 用户权限，Manifest 和路由不是恶意代码隔离；退役 isolation 配置须明确失败，不静默降级。
- Web/Notify 使用普通受控生命周期，保留依赖、审批、备份、数据损失和实际停止守卫；自动回滚仅限既有精确激活及数据安全条件。
- Remind 源码及依赖材料保留，恢复运行需明确决定；Editor 已退役。不得为旧调用方恢复已移除的公开接口或兼容系统。
- 不把 `schedules/projects/history/chat/provider/executions/content/memory` 恢复成公开 kernel 命名空间。持久唤醒使用窄 `timers` 接口；业务日历和调度策略归应用。
- 应用数据私有，跨应用通过拥有者的有界工具读取；Provider 已有文件、shell、web 能力，不重复造 Chrona 工具。
- Author 只接收、导出和提交精确材料；当前 Agent 在已有 Run 中开发和构建。保留源码、锁、构建输入、制品字节及可执行模式验证。
- 内核事务保存有限事实，唯一选定应用负责持久接收和通知；先持久化、再 ack、再投递，恢复前核对撤回。
- 不自动提交、推送、部署、操作真实账号/数据库、发送外部消息、删除或迁移真实数据；这些需要用户对具体任务的授权。

## 最小实现

- 先删除不必要代码，复用已有应用/组件/依赖，其次使用标准库；不引入预留抽象、第二套队列或无需求的 hook 框架。
- 原始输入和持久数据在信任边界验证一次，同一操作复用解析结果；同一写事务复用已读身份，审批、异步交付等可变边界再检查。
- fallback、重试和防御分支必须对应可达失败或明确边界；意外错误应传播，不伪装成成功或空结果。
- helper 应有清楚职责或复用价值，不为绕 lint 搬代码；测试替身只实现消费者需要的最小公共合同。
- 修改共享行为先检查调用方；同步必要测试、生成合同和发行资源，避免无关重构。
- `packages/contracts/src/steward/index.ts` 由协调者负责；委托任务只能提议修改，不能直接编辑。

## 代码与专题入口

| 范围 | 位置／阅读入口 |
| --- | --- |
| 依赖方向 | `apps → packages/engine → packages/domain → packages/contracts`；路由校验并委托，domain 无 I/O |
| 合同／kernel | `packages/contracts/src/steward`、`packages/engine/src/modules/steward`；[当前边界](docs/zh/kernel-permanent-boundary-contract.md) |
| 应用 | `steward/external/`（含普通 Provider 应用 `pi`）；[普通应用迁移](docs/zh/application-migration.md) |
| 宿主／SDK／Pi | `packages/integrations/src/steward`、`packages/pi`；[Agent](docs/zh/agent-builtin-application.md) |
| Web | `external/web/src/pages.tsx`、`src/system/`、`app.js`；[组合与外壳](docs/zh/web-components-and-shell.md)、[可执行组件](docs/zh/web-executable-components.md) |
| 设置／材料 | [应用设置](docs/zh/application-settings.md)、[版本材料](docs/zh/author-version-materials.md)、[当前对话创作](docs/zh/author-current-conversation.md) |
| 通知／恢复 | [有限事实](docs/zh/kernel-notification-facts.md)、[运维](docs/zh/operations.md) |
| 可选工具 | 当前会话有 context-mode / CodeGraph 时，按需读[工具手册](docs/agents/tooling.md)；没有则用原生工具，不臆造可用性 |

## 数据与检查

- 开发和测试用全新临时数据；不做旧库兼容。首次重建产品发布前，schema 变更同步唯一 `prisma/migrations/0001_initial`。
- 生成初始迁移：`bunx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`。保留已应用 checksum 与旧库拒绝守卫。
- 数据库代码在 `packages/db`；停止服务后用 `chrona backup` 备份完整数据、platform、sessions 和 secrets，不能只复制 SQLite。
- 定向优先：`bun test <paths>`；必要全量：`bun run typecheck`、`bun run lint`、`bun run test:bun`、`bun run test:api`。
- 重型检查串行限内存，例如 `systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=1G env NODE_OPTIONS=--max-old-space-size=6144 bunx tsc --noEmit`。
- 状态推导改动用表驱动测试；UI 验证可见文字、角色和下一步，覆盖空、加载、错误、等待及完成。自动测试不调用真实模型或 QQ。
- 只跑验证改动所需的检查；未跑或失败必须说明。不能以测试数量、运行连接或自报健康代替业务就绪。

## Web

- 中文优先，共用 React/json-render 渲染器；静态页不带数据，数据经用户鉴权后的 `/api/web` 获取。
- Web 负责 shell、主题和导航；页面显式声明 `layout: document|workspace`。应用设置由应用页面和工具保存，不由 Web 从工具名推断。
- 可信可执行组件直接在同页运行，无浏览器安全隔离；保留真实版本、页面与回调合同检查，卸载时清理资源。
- 使用显式 `Composer.on.submit` 和应用提供的 `WorkspaceHeader.statusTone`；详情按需读组合合同。
- 页面改动用真实浏览器验证 `1440×900`、`1024×768`、`390×844`，手机不得横向滚动。
- 主操作和待决定事项明显；文案使用应用、文件、会话、通知，不暴露不必要的 Run、grant、token 术语。
