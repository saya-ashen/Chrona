# 内核永久边界收缩实施记录

状态：2026-11-09 本轮代码收缩与 G1–G7 工程验收完成；**UNFROZEN（永久边界仍为冻结候选）**。完整命令、结果、跳过项及限制见[本轮验收记录](kernel-permanent-boundary-validation.md)。本轮目标是完整永久收缩，包括公开合同、应用所有权、调用方和打包入口，不限于修复若干授权问题。[合同盘点](kernel-permanent-boundary-contract.md)列出当前输入、输出和权限。[研究报告](../../reports/内核%20永久%20冻结%20边界.md)是设计背景，不是当前运行或测试结果。

## 范围与不可退让的约束

- 只有内核与应用两类；`runtime-callback`、`workspace-local` 是内核内部宿主，不构成第三类或公共能力。
- Agent 是唯一不可变内置应用，Pi 是唯一内置 Provider。Agent 私有模型政策与应用配置归应用；内核保留身份、精确授权、硬预算、单 Run 队列、租约、取消、实际停止、固定结果和敏感交付。
- Web/Notify 是普通可更新、暂停、替换、申请删除的默认预装应用，和 QQ、Author 一样不因预装获得特权；不自动补装、不覆盖已有选择。依赖、入口、审批、备份及数据损失守卫仍须生效。
- 使用临时数据库和全新数据目录验收；不迁移现有用户数据，不保留旧接口、旧代码兼容或别名兜底。不操作既有服务、真实账号、网络、模型或生产环境；不自行部署或 push。
- 暂停高成本调用方时保留全部源码与依赖材料；暂停必须覆盖真实运行、工具、HTTP/UI、初始化和发布入口，不能把保留源码当作支持安装。暂停不授予定时删除授权。
- 不以应用自报代替执行点检查；未知停止仍占容量，未知非幂等效果不自动重投。不建设第二套执行队列、未来 Provider 注册、通用 timer bus 或策略 hook 框架。
- 只有所有门禁满足并由主负责人确认后才宣布冻结；此后才适用公开合同只增不删。冻结前可同步删除仓库内旧调用与接口。

## 当前主要源码实际结构

以下是实现结构；工程出口已经按[验收记录](kernel-permanent-boundary-validation.md)完成本轮范围验证。路径相对于 `packages/engine/src/modules/steward/`，共享 schema 另列。

| 边界 | 当前实现 | 联合验证内容 |
| --- | --- | --- |
| 公开注册 | `system-modules.ts` 只注册 `approvals/modules/settings/secrets/activity`；Agent 通过应用路由 | 公共发现、实际调用和拒绝旧入口保持一致 |
| modules 工具 | `system/modules.ts` 恰好 `list/tools/reference/diagnostics/health/admit-candidates/source/submit/candidate-check/rollback/disable/enable/remove` 13 个 | 调用方、资源及旧描述无依赖泄漏；没有隐式 latest、build 或 group API |
| 固定材料 | `module-candidates.ts`、`module-candidate-records.ts` 固定 issuer、submitter、完整目标集合和精确活动基线；冻结文件及 Git revision，事务保存 receipt 后进入检查 | 并发、文件变化、lost reply、审批后状态变更、集合原子性和数据条件 |
| 发现与 pinning | `modules.tools` 返回真实 `moduleId/hash/contractHash`；`modules.reference` 显式过滤暂停应用，注册索引/详情 output schema；异步目标以 `expectedTarget:{moduleId,contractHash}` 固定身份与合同；私有宿主不在公开目录 | 实际过滤与 schema/wire 一致、合同变更拒绝、未知效果和 waiting/error wire |
| 审批 | `system/approvals.ts` 仅公开 `list/resolve/request/status`；resolve 输入只有 approval/decision；`ACTIONS` 精确为 `activate_module/delete_data/modify_external` | 旧 grants/revoke、always/scope 的真实拒绝；原等待 call 恢复且不创建通用或 standing grant；调用方与资源同步 |
| 治理配置 | `settings.ts` 只持有 `timezone/modelUsage/moduleModel`；`builtin/agent/model-policy.ts` 在 Agent 私有 data 管 tier→model/thinking 和偏好 timeout | 应用政策始终受 kernel 硬上限约束；无私有路径或身份自授 |
| 健康观察 | `module-diagnostics.ts` 只读运行/故障证据；不调用自检、模型或业务探测 | unknown 与业务就绪展示准确，无旧 report-health/healthCheck 消费 |
| 通知事实 | `notification-facts.ts` 与 `system/activity.ts` 单消费者、revision、facts/ack/withdrawals；Notify 自有存储、预算、投递政策 | 消费者切换、持久摄取后 ack、恢复 tombstone、混合摘要与无内核直接投递 |
| 普通默认应用 | `module-initialization.ts` 与共享 `module-lifecycle.ts` 默认预装 Web/Notify/QQ/Author，账本记录安装或跳过 | 普通身份、删除与替换、不自动补装、发布产物一致 |
| Agent/宿主 | Agent 独立 SDK 进程与 Pi；`agent-application.ts/agent-delegation.ts` 绑定实际 call、身份、Run；`local-provider.ts/local-workspace.ts` 提供私有宿主 | 旧 module 六分支拒绝、预算/取消/重启/unknown/实际停止和宿主路径隔离 |
| 凭据 | `system/secrets.ts` 重新核对当前批准 Manifest；敏感 get/set/authorize/token 不记录；OAuth 必要机制保留 | 凭据与 OAuth 工程路径已验收；逐字段永久承诺仍归冻结审议 |

### 当前材料作者能力

`external/author/` 是普通默认预装应用，实际工具为 `prepare/write/read/list/stage/source/submit/receipt`。`prepare` 返回 `kind:"material-only"`、准入草案、prompt 和 `execution.supported:false`；没有开始模型，也没有自动签发准入。

当前流程是 owner 核对 Author 的批准身份和全部目标 → owner 调用 `modules.admit-candidates` → 显式供给材料或导出准入内的精确 Git 基线 → Author 编辑/整理 → `modules.submit` → 以 receipt 或 admission/request 精确核对。准入仅授权一次完整材料提交，不授权指定模型、timeout 或 submission caps 的执行。`agent.context/run` 当前未强制 admission-bound 的这些精确执行条件，因此不能宣称自动模型作者已完成，不能自动续跑或付费重试。

### Pi completion 当前限制

`packages/integrations/src/steward/pi-model-gateway.ts` 的隔离 completion 使用单个受信 token-limit extension，当前只按 Pi 1.5.0 验证，且只允许请求原生带有已支持输出 token cap 的 Provider。Codex（`openai-codex-responses`）及不支持该 cap 的模型在 model completion 路径 fail closed；普通前台 Pi RPC 不受影响。此处记录源码限制，不代表完成真实模型验收，也不扩大本轮验收授权。

### Manifest 收缩

`packages/contracts/src/steward/index.ts` 的严格 `moduleManifestSchema` 当前字段为 `name,description?,entry,tools,keepAlive,activated,content,listen?,uses,packages,secrets,model?,effects,params,limits?,data,tests`。已移除 `settings,triggers,dynamicSchedules,channel,contributes,healthCheck,builds`。`effects` 只有 network；`params` 是版本常量。应用配置和偏好经私有工具管理。保留数据 schema/migrate 及恢复安全守卫，不表示本轮要迁移已有用户数据。

## 当前暂停状态与历史源码保留清单

当前仅 Remind 整应用暂停并保留源码；Mind 正恢复为普通可选应用、不预装，最终验收待完成，见[实施记录](mind-implementation.md)。Coding 和 coding-web 已恢复为普通可选应用，见[实施记录](coding-peer-clients-implementation.md)。Editor 已退役并移除，见[退役记录](editor-retirement.md)。以下表格和 G5 的计数是最初永久收缩验收的历史快照，不表示当前仍保留 Editor 或暂停 Coding。

| 应用/功能 | 原收缩验收时源码状态 | 当时恢复前要求 |
| --- | --- | --- |
| Mind、Coding、Editor、Remind | `module-availability.ts` 精确暂停名单 `mind,coding,editor,remind`；源码和依赖材料保留；路由拒绝为 `unavailable` / `module_paused`，初始化相关项 skipped | 安装、运行、HTTP/UI、打包与依赖入口关闭已验收；迁到普通应用合同后再恢复 |
| memory-local 定时 consolidation | 整个应用不在暂停名单；保留 recall/retain/forget/preferences/remember/conversation-context/conversation-retain；定时整理暂停 | 普通应用自行持有整理政策；不恢复旧内核调度接口 |

MCP 已在 2026-11-09 后续迁移中恢复普通可选应用准入，详见 [MCP 迁移记录](mcp-minimal-boundary-migration.md)。原永久收缩验收中的五应用暂停计数为当时快照。

当前可用性以本节状态说明、各应用后续实施记录与当前源码为准；历史验收不单独证明当前可用性。Mind/Remind 保留源码不能推导删除权限；Editor 的删除已由用户另行批准，范围见退役记录。

## 已完成的合同清理与保留内部机制

以下实现已纳入本轮工程验收；永久冻结状态单独记录：

- modules schema 文案已收窄到当前 reference/rollback 合同；Manifest model 校验只针对 `agent.complete`。Web Manifest 不再声明旧 schedules 或 modules 查询/构建目标。
- `module-reference.ts` 显式跳过暂停应用；`system/modules.ts` 注册 `modulesReferenceOutput`，覆盖无 target 索引数组及有 target 详情对象。目标自身 `outputSchema:null` 仍表示未声明。
- SDK 已移除 `chrona.model/notify/wakeProvider`；公开 `Trigger` 排除 schedule。私有 `WireTrigger` 及 schedule delivery/tick drain 仍接通；公开 API 删除不等于删除内部 drain。
- `activity.runtime` 与 health schema 不再包含 `dueSchedules`。Notify Manifest 的 kernel 可见声明本身不证明内核直接调用 Notify。
- approvals 四工具及三种 action 已收窄；公开 resolve 没有 scope，内部固定 once。共享 Grant/policy 存储与 schema 仍存在，但不注册公开 grants/revoke，也不代表公开支持 standing grant。
- **已删除 Notify 路由特例**：`module-effects.ts` 与 `module-calls.ts` 不再接受 lenient。普通应用异步调用缺失或不可用的 Notify，与调用其他缺失应用一样，在入队前拒绝；只有内核内部调用保留受限的延迟解析路径。
- `module-generation.ts` 仍检查候选/旧版本的 `uses.includes("schedules.create")`，用于拒绝旧 scheduler 依赖下的自动回滚；这是保留安全守卫。旧 `provider.complete`、`chrona.notify` 助手说明已移除，模型声明只针对 `agent.complete`。

调用方、UI 与发布资源按同一轮源码共同验收；旧研究记录保留为设计依据，不作为当前运行结果。

## 联合门禁与结果

本轮执行了临时数据库测试、隔离浏览器验收、离线发布构建和全新数据目录运行烟测，未执行真实模型、真实账号或既有服务验收。源码基线为 `cf19ceb704800e5c53e0784aff4558883f6afa9b` 加本轮未提交工作区改动；不能把基线 SHA 当作已包含改动的发布 revision。最终检查证据在下表及验收记录中列出。

| 门禁 | 验收出口 | 当前记录 |
| --- | --- | --- |
| G1 身份、授权与 wire | HTTP health/API 鉴权；真实 owner/模块身份；waiting/error/unknown；contractHash 与 expectedTarget；敏感值不记录 | 通过，见[验收记录](kernel-permanent-boundary-validation.md) |
| G2 材料准入与固定 receipt | 精确 issuer/submitter/完整目标、路径与 symlink、固定 Git 材料、单次消费、同 key 冲突、并发及 lost reply、集合不部分激活、凭据与迁移守卫 | 通过，见[验收记录](kernel-permanent-boundary-validation.md) |
| G3 公开面与调用方 | 五命名空间、13 modules 工具、4 approvals 工具与 3 actions、Agent 独立应用、私有宿主不发现；移除接口/参数真实拒绝；reference 过滤与输出合同；Manifest/SDK/调用方/资源和保留类型核对 | 通过，见[验收记录](kernel-permanent-boundary-validation.md) |
| G4 应用普通化与通知 | Web/Notify 普通生命周期、删除替换/不补装/不覆盖；facts 消费权、ack 前持久化和 withdrawals；应用私有配置 | 通过，见[验收记录](kernel-permanent-boundary-validation.md) |
| G5 暂停及资源 | 五应用入口和依赖真实停用、源码/依赖材料保留；memory-local 整理暂停；打包无旧入口恢复 | 通过，见[验收记录](kernel-permanent-boundary-validation.md) |
| G6 执行与凭据 | Agent/Pi 唯一内置；configure 私有模型政策与 kernel caps；重启/租约/取消/unknown/实际停止；必要 OAuth 与秘密交付 | 通过，见[验收记录](kernel-permanent-boundary-validation.md) |
| G7 仓库联合检查 | 全新临时环境，适当定向及全量静态/测试/打包检查，重型检查串行且限内存；禁止真实模型/QQ | 通过，见[验收记录](kernel-permanent-boundary-validation.md) |
| G8 冻结审议 | 每个工具/字段的输入、输出、授权、pinning、兼容添加语义明确；G1–G7 全部有证据并完成残留处置 | **UNFROZEN：合同仍为冻结候选，未宣布永久承诺** |

验收以当前结果为准；真实模型、真实账号和生产部署不在本轮范围。合同仍作为冻结候选管理，实施完成本身不替代公开边界的永久承诺。
