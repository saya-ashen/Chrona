# Chrona — 开发指引

Chrona 仓库只维护通用内核、宿主、CLI、数据库及 SDK。具体应用实现、应用共享业务、专属配置、页面、测试和固定发行材料均归独立应用仓；不得在主仓保留临时应用接线。默认中文，代码、命令和标识符保持原样。
技术栈：Vite + Hono monorepo、Bun、严格 TypeScript、SQLite/Prisma；没有 Next.js。

## 开始工作

- 先检查当前目录及更具体的 `AGENTS.md`、`git status` 和相关 diff，保留用户未提交改动。
- 产品依据：[设计目标](docs/zh/steward-goals.md)。设计 API 时再读[目标规范](docs/zh/kernel-api-design.md)。
- 当前实现：[架构](docs/zh/architecture.md)及 `packages/contracts/src/steward`。目标不等于实现，当前边界 **UNFROZEN**。
- 按任务从[文档索引](docs/README.md)读取专题；不要求通读历史方案、部署记录或工具手册。
- 使用当前合同中的领域术语；相关目录有 ADR 时按需阅读，发现冲突明确指出。不存在的上下文或 ADR 文档不要求补建。
- 代码存在、测试通过、隔离验收、实际部署和真实使用分别报告；不以旧版本验收证明当前能力。
- 后续 API 目标不是立即改代码的授权；任务范围、优先级和外部操作以本次用户指令为准。

## 架构边界

以下是职责划分和真实风险（外部副作用、凭据、真实数据）的边界，不是“多加检查”的理由；新增守卫仍须满足下文“检查要有对象”。

- 只有 kernel 与应用。业务策略、会话、记忆、展示、配置和通知归应用；共享复用本身不构成提升到 kernel 的理由。
- 通用 Agent API 归 kernel；具体 Provider 由独立应用登记，主仓不依赖 Pi、不携带默认预装名单或应用固定材料。允许空内核启动，配置及凭据由应用通过批准声明管理。以 `kernel-api-design.md` 第 9 节七工具合同为实现目标。
- 保留唯一 Run 队列、真实 caller、精确授权、硬预算、租约、取消、未知停止占用和实际停止证据；不能用错误文案推导授权或停止。
- caller、Run token、宿主 cwd/session 和回调身份由内核绑定，不能从应用参数自授。元数据、外部文本和模型回复不授予权限。
- owner 准入检查当前批准版本的显式 `authority: "owner"`；`uses` 仅声明合同，`["*"]` 不授予权限。
- 未知外部效果不自动重放；丢回复后查询原固定回执，不更换请求 key 猜测重试。审批绑定具体动作，不产生 standing grant。
- 凭据的值不进 prompt、日志或普通工具结果；失败原因照常记录。读取凭据仍检查实际应用及批准声明，不能关闭脱敏或鉴权来解决问题。
- trusted-local 使用同一 OS 用户权限，Manifest 和路由不是恶意代码隔离；退役 isolation 配置须明确失败，不静默降级。
- Web/Notify 使用普通受控生命周期，保留依赖、审批、备份、数据损失和实际停止守卫；自动回滚仅限既有精确激活及数据安全条件。
- 应用停用与退役策略由应用及用户管理；内核不按应用名设置例外。不得为旧调用方恢复已移除的公开接口或兼容系统。
- 不把 `schedules/projects/history/chat/provider/executions/content/memory` 恢复成公开 kernel 命名空间。持久唤醒使用窄 `timers` 接口；业务日历和调度策略归应用。
- 应用数据私有，跨应用通过拥有者的有界工具读取；Provider 已有文件、shell、web 能力，不重复造 Chrona 工具。
- Author 只接收、导出和提交精确材料；当前 Agent 在已有 Run 中开发和构建。保留源码、锁、构建输入、制品字节及可执行模式验证。
- 内核事务保存有限事实，唯一选定应用负责持久接收和通知；先持久化、再 ack、再投递，恢复前核对撤回。
- 不自动提交、推送、部署、操作真实账号/数据库、发送外部消息、删除或迁移真实数据；这些需要用户对具体任务的授权。

## 最小实现

- 先删除不必要代码，复用已有应用/组件/依赖，其次使用标准库；不引入预留抽象、第二套队列或无需求的 hook 框架。
- 原始输入和持久数据在信任边界验证一次，同一操作复用解析结果；同一写事务复用已读身份，审批、异步交付等可变边界再检查。
- helper 应有清楚职责或复用价值，不为绕 lint 搬代码；测试替身只实现消费者需要的最小公共合同。
- 修改共享行为先检查调用方；同步必要测试、生成合同和发行资源，避免无关重构。
- `packages/contracts/src/steward/index.ts` 由协调者负责；委托任务只能提议修改，不能直接编辑。

## 失败与诊断

- 每个 `catch` 要么传播，要么写一行带原因的结构化日志（`console.error(JSON.stringify({ component, event, error }))`）；禁止空 `catch`、只返回 null/false 的 `catch` 和 `.catch(() => {})`。对调用方隐藏细节时，原因仍写日志。
- 完成标准必须回答：“这里在线上失败时，运维能否只看日志说出原因？”不能则补日志，而不是补兜底。
- 只读查询、流式回调和可重算的结果不入库；持久化只保存后续机制真正读取的状态，并说明谁读、保留多久。
- 测试断言边界上的可见行为，不断言内部账本行或诊断记录，除非它本身就是对外合同。

## 检查要有对象

- 每个校验、身份比对、容量上限、fence 或 fallback 都写明它挡住的现实失败或威胁。trusted-local 下同一 OS 用户的进程互相比对身份不算安全收益；说不出对象就不要加，已有的删掉。
- 安全不能以“不可诊断”或“升级即失效”为代价；需要人工步骤才能保持可用的检查，要么自动化，要么删除。
- 审查先问“哪些可以删、diff 能否更小”，再问是否完整；报告每个切片的净增减行数。

## 代码与专题入口

| 范围 | 位置／阅读入口 |
| --- | --- |
| 依赖方向 | `apps → packages/host → packages/kernel → packages/domain → packages/contracts`；kernel 与 host 共用 `packages/app-sdk`；路由校验并委托，domain 无 I/O |
| 合同／kernel | `packages/contracts/src/steward`、`packages/kernel/src`；[实现现状](docs/zh/kernel-api-implementation.md) |
| 应用 | 独立 `chrona-module-*` 仓库；源码、业务共享、页面、测试和构建材料在各自仓库维护，不复制到 Chrona |
| 宿主／SDK | `packages/host`、`packages/app-sdk`；仅通用进程、资源、传输及调用合同 |
| HTTP | `apps/server`；通用传输与内核端点，客户端鉴权和页面归实际 listener 应用 |
| 设置／材料 | [应用设置](../chrona-module-web/docs/application-settings.md)、[版本材料](../chrona-module-author/docs/author-version-materials.md)、[当前对话创作](../chrona-module-author/docs/author-current-conversation.md) |
| 通知／恢复 | [有限事实](docs/zh/kernel-notification-facts.md)、[运维](docs/zh/operations.md) |
| 可选工具 | 当前会话有 context-mode / CodeGraph 时，按需读[工具手册](docs/agents/tooling.md)；没有则用原生工具，不臆造可用性 |

## 数据与检查

- 开发和测试用全新临时数据；不做旧库兼容。首次重建产品发布前，schema 变更同步唯一 `packages/db/prisma/migrations/0001_initial`。
- 生成初始迁移：`bunx prisma migrate diff --from-empty --to-schema packages/db/prisma/schema.prisma --script`。保留已应用 checksum 与旧库拒绝守卫。
- 数据库代码在 `packages/db`；停止服务后用 `chrona backup` 备份完整数据、platform、sessions 和 secrets，不能只复制 SQLite。
- 定向优先：`bun run verify:slice <paths>` 或 `bun test <paths>`；收工前必须运行全量 `bun run verify:slice`（串联 `lint:ratchet`、`typecheck`、`check:guardrails`、分层边界与关联测试），必要时补跑 `bun run test:bun`、`bun run test:api`。
- 重型检查串行限内存，例如 `systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=1G env NODE_OPTIONS=--max-old-space-size=6144 bunx tsc --noEmit`。
- 状态推导改动用表驱动测试；涉及队列、配额、显式重试或跨事务等待的状态机改动，必须覆盖 `packages/kernel/src/__testing__/state-machine-invariants.ts` 的反例契约（终态释放配额、阻塞头不饿死尾、显式重试推进新尝试、交错结算收敛），不得只测 happy-path。
- 状态机或跨模块改动收工前，派独立只读 `reviewer` 核对三件事：是否靠压单行/空 catch 绕过规则、是否引入无消费者的持久化、配额/游标/幂等 key 在异常与并发下是否死锁。
- UI 验证可见文字、角色和下一步，覆盖空、加载、错误、等待及完成。自动测试不调用真实模型或 QQ。
- 只跑验证改动所需的检查；未跑或失败必须说明。不能以测试数量、运行连接或自报健康代替业务就绪。

## Web

- 中文优先，共用 React runtime 与 UI 组件，应用通过 `page-set` 直接登记可执行页面；静态页不带数据，数据经用户鉴权后的 `/api/web` 获取。
- Web 负责 shell、主题和导航；页面显式声明 `layout: document|workspace`。应用设置由应用页面和工具保存，不由 Web 从工具名推断。
- 可信可执行组件直接在同页运行，无浏览器安全隔离；保留真实版本、页面与回调合同检查，卸载时清理资源。
- 使用显式 `Composer.onSubmit` 和应用提供的 `WorkspaceHeader.statusTone`；详情按需读组合合同。
- 页面改动用真实浏览器验证 `1440×900`、`1024×768`、`390×844`，手机不得横向滚动。
- 主操作和待决定事项明显；文案使用应用、文件、会话、通知，不暴露不必要的 Run、grant、token 术语。

<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, read these installed skill files directly (use these paths even if a same-named global skill exists):
- Core filter, always on: `antislop`: `.pi/skills/antislop/SKILL.md`
- UI / visual: `antislop-ui`: `.pi/skills/antislop-ui/SKILL.md`
- Code comments: `antislop-code`: `.pi/skills/antislop-code/SKILL.md`
Before starting, follow the core's "Two Usage Modes" section in strict order: explicit session instruction first, then global preference, then ask. A session instruction always wins. For a resolved mode, say `antislop active: <mode> (session override).` or `antislop active: <mode> (global preference).` once before presenting findings or making edits, using the actual mode and source. Acknowledging the user's request without naming the source does not replace this notice.
Only an explicit choice of antislop during or after selects a session mode. A request to review, audit, or avoid file edits does not select a mode; read the global preference in that case. Another skill's mode does not select antislop's mode.
If the mode is unresolved, ask during/after and end the response; wait for the answer before any UI review, planning, or concept. For read-only tasks, put the active-mode notice only at the start of the final answer, never in progress messages. For editing tasks, announce before the first edit and omit it from the final answer.
To update antislop later: `npx antislop-ai --update`, or run `npx antislop-ai` and pick Overwrite them.
<!-- antislop:end -->
