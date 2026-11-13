# 模块生命周期、构建与公开管理 API：永久冻结边界独立审计

**审计基线：** `/home/saya/workspace/Chrona`，HEAD `cf19ceb704800e5c53e0784aff4558883f6afa9b`。仅静态阅读本地源码；未修改文件，未运行测试、模型、网络、部署或数据库操作。报告由当前会话结果交付，不另写源码或文档。

**判定前提：**

- 永久公开契约冻结后只能增加，不能删除；因此**现有接口不是保留理由**。
- 只采用“内核／模块”两类实体。`web`、`notify` 是普通预装、可移除和替换的模块；`agent` 保持可信内置，Pi 是唯一内置 Provider。
- 下文明确区分：
  - **事实**：当前源码实现及生产调用。
  - **建议**：冻结前应采用的边界，不表示当前已经实现。
- 分类：
  - **FREEZE**：保留最小公开内核原则；不代表冻结当前名字、完整参数或返回结构。
  - **PRIVATE**：保留在内核／宿主内部，不构成应用契约。
  - **MOVE**：用户行为保留，由模块拥有流程或业务契约。
  - **DELETE**：删除重复公开面或失效描述，必要底层能力由其他最小接口承接。

**核心结论：当前 `modules` 公开面不宜直接永久冻结。** 它把代码提交与原子切换、官方软件分发、AI 作者流程、应用配置表单、就绪状态、权限页聚合及宿主能力目录放在同一命名空间。应冻结的是“经过授权与检查的版本生命周期”和“可核对的内核事实”，不是这些现有工作流及投影。

---

## 一、当前到底公开了什么，谁在生产中使用？

### Takeaway

审计基线中 `system/modules.ts` 注册 **31 个工具**，包含数组生成的五个名称；下表已剔除退役构建入口，不代表当前工具清单。其公开义务远大于工具数量：当前契约还包含官方包枚举、Git 上游协议、构建会话与队列策略、应用设置 DSL、健康状态机、权限页面结构，以及将宿主能力当作目录条目的分类体系。

### Cited Findings

### 1. 注册与名称转换规则

注册入口：`packages/engine/src/modules/steward/system/modules.ts:159-197`。

Provider 工具名按以下规则生成：

```ts
name: `m_${system.name}_${tool.name.replaceAll("-", "_")}`
```

生产实现：`packages/engine/src/modules/steward/module-tools.ts:13-18`。

这不表示每个名称都向 Provider 开放。`systemEntries(audience)` 先按 `visibility` 过滤，再生成对应受众目录。模块可调用性还受路由准入及工具处理函数的进一步限制。见 `packages/engine/src/modules/steward/module-tools.ts:13-18`、`packages/engine/src/modules/steward/module-calls.ts:157-164`。

### 2. 基线逐工具矩阵（已剔除退役入口）

表内 `m_modules_*` 是依上述规则转换的名称；是否实际进入某受众目录取决于可见性。

| 工具及注册位置 | 当前输入、输出与用户行为 | 已核实生产调用方 | 冻结前判定及最小替代路径 |
|---|---|---|---|
| **`catalog`** → `m_modules_catalog`，`packages/engine/src/modules/steward/system/modules.ts:165` | 无输入；官方包、release 可用性、Git 来源、安装身份、最新安装回执。包名由内核枚举。 | Web `GET /catalog`：`packages/engine/src/modules/steward/builtin/web/index.ts:159`；MCP `chrona_module_catalog`：`packages/engine/src/modules/steward/external/mcp/index.ts:70`；CLI：`packages/cli/src/admin.ts:55`。 | **MOVE**。包目录是软件分发模块的数据；用户仍能浏览和安装。内核仅接受该模块提交的固定候选，并执行同一检查队列。官方 release 读取可保留宿主私有实现，不永久公开官方包清单。 |
| **`install`** → `m_modules_install`，`packages/engine/src/modules/steward/system/modules.ts:166` | `{package, mode:"install"\|"update", requestKey}`；返回安装阶段、moduleId/hash/approvalId/error。支持不确定结果的同 key 查询，不暗中覆盖现有定制。 | Web `POST /install`：`packages/engine/src/modules/steward/builtin/web/index.ts:160`；MCP `chrona_module_install`：`packages/engine/src/modules/steward/external/mcp/index.ts:71-76`；CLI：`packages/cli/src/admin.ts:56`。 | **MOVE** 安装工作流；**FREEZE** 候选提交、身份冲突及精确结果核对原则。替代为分发模块的安装请求 → 内核候选提交 → 内核检查／审批／切换。不得把“移动”实施为分发模块直接写平台目录或自行批准版本。 |
| **`upstream`** → `m_modules_upstream`，`packages/engine/src/modules/steward/system/modules.ts:167` | `status/fetch/merge`；merge 绑定 moduleId、commit、baseHash、requestKey。返回 repository/branch/localCommit/fetchedCommit/proposal。 | 路由处理确实可达：`packages/engine/src/modules/steward/system/modules.ts:208`。本次在已读 Web/MCP/CLI 生产入口中未发现具名直调；内部官方 update 复用 `submitMergedCommit`，不是调用公开 `modules.upstream`。 | **MOVE** Git 拉取、合并和回执。替代为分发／作者模块在自己的工作区合并，再提交固定候选；内核仍校验目标身份和预期当前版本，不接受调用方“已经安全”的声明。 |
| **`list`** → `m_modules_list`，`packages/engine/src/modules/steward/system/modules.ts:168` | 返回 Module 行、origin/capabilities、description、完整版本集合、最近五次模块运行和健康投影；Provider 版本截到五个并带 versionCount。 | Web 列表及应用详情；MCP `chrona_modules`；notify/events 目录；会话 Agent 工具集。见 `packages/engine/src/modules/steward/builtin/web/app-overview.ts:26-34`、`packages/engine/src/modules/steward/external/mcp/index.ts:69`、`packages/engine/src/modules/steward/builtin/notify/index.ts:11`、`packages/engine/src/modules/steward/external/events/index.ts:7`。 | **FREEZE，显著瘦身**：安装身份、选中版本、启停状态、必要声明引用。版本历史、运行记录、健康状态应按需读取；不冻结 DB 行展开、五次运行、origin 三分法、固定 capabilities 布尔全集。 |
| **`diagnostics`** → `m_modules_diagnostics`，`packages/engine/src/modules/steward/system/modules.ts:169-170` | 可选 module；最多 100 个模块，当前健康加各最多五条 incidents/contractFailures/evolution；不启动进程或模型。构建 Provider 被限制在授权目标内。 | Web diagnostics；MCP `chrona_module_diagnostics`；mind Agent 工具；构建 `BUILD_MODULE_TOOLS`。见 `packages/engine/src/modules/steward/builtin/web/index.ts:118`、`packages/engine/src/modules/steward/external/mcp/index.ts:87`、`packages/engine/src/modules/steward/external/mind/execution.ts:8`、`packages/engine/src/modules/steward/module-reference.ts:11`。 | **FREEZE 最小内核观察事实；MOVE 解释与下一步文案**。保留可信身份／版本／激活归属、实际故障与未知效果证据、有限历史和不完整标记；不永久冻结目前恢复策略、状态机全字段和中文 nextAction。 |
| **`health`** → `m_modules_health`，`packages/engine/src/modules/steward/system/modules.ts:171` | `{open?:"true"\|"false",cursor?}`；最多 50 条当前健康摘要，按名称分页。`open` 是特定内核投影规则。 | Web Today：`packages/engine/src/modules/steward/builtin/web/today.ts:9`；mind 分页：`packages/engine/src/modules/steward/external/mind/index.ts:68-72`；构建工具集：`packages/engine/src/modules/steward/module-reference.ts:11`。 | **DELETE 当前重复公开投影**，并入同一最小观察事实接口；Web/mind 自行筛选“需要关注”。不能先删后让它们用全部诊断日志代替轻量状态；须先提供轻量、有分页的事实读取。 |
| **`interfaces`** → `m_modules_interfaces`，`packages/engine/src/modules/steward/system/modules.ts:172` | 可选 module；返回内核接口／本地能力声明或指定应用工具声明，含 origin/capabilities/sessions/runtime 和工具元数据。 | Web/MCP `systemApps`、`appOverview`：`packages/engine/src/modules/steward/builtin/web/app-overview.ts:6-34`；MCP `chrona_system_apps`：`packages/engine/src/modules/steward/external/mcp/index.ts:82-84`。 | **DELETE 独立聚合面**。工具声明并入唯一目录；宿主配置私有；Agent 自己报告其配置与能力。Web 应用页面由安装清单和目录组成，不再把 `workspace-local` 等塑造成第三类实体。 |
| **`settings-get`** → `m_modules_settings_get`，`packages/engine/src/modules/steward/system/modules.ts:173-174` | `{module}`；返回 `{declarations,values}`，含系统模块与本地能力的特殊分支；值按 manifest 声明合并 defaults。 | Web/MCP 应用详情；入口 memory 读取 provider 设置。见 `packages/engine/src/modules/steward/builtin/web/app-overview.ts:22,31`、`packages/engine/src/modules/steward/builtin/web/memory.ts:56`。 | **MOVE 应用设置契约**。普通模块的 `settings` 工具从私有数据返回表单／值；Web 按其声明渲染。真正内核预算设置仍由其专门内核边界提供，不通过“所有模块通用设置 DSL”混合。 |
| **`settings-set`** → `m_modules_settings_set`，`packages/engine/src/modules/steward/system/modules.ts:175-176` | `{module,values:JSON字符串}`；依据 active manifest 校验字段和值，部分更新 workspace.settings.moduleSettings，随后触发健康刷新。 | Web POST settings：`packages/engine/src/modules/steward/builtin/web/index.ts:122`；MCP `chrona_app_settings`：`packages/engine/src/modules/steward/external/mcp/index.ts:85`；Web 全局设置中的自身 memory 配置：`packages/engine/src/modules/steward/builtin/web/settings.ts:36`。 | **MOVE**。各模块持久化、校验并提供 owner 可见修改工具；路由继续执行真实调用方与可见性。JSON 字符串、设置类型枚举及“保存后内核刷新健康”都不应永久冻结。 |
| **`permissions`** → `m_modules_permissions`，`packages/engine/src/modules/steward/system/modules.ts:177` | `{module}`；capabilities 中文描述、credentials 配置状态／字段视图、model/today、未消耗授权和最近十条审批。 | Web permissions 与详情；MCP `chrona_module_permissions`：`packages/engine/src/modules/steward/builtin/web/index.ts:119`、`packages/engine/src/modules/steward/builtin/web/app-overview.ts:31`、`packages/engine/src/modules/steward/external/mcp/index.ts:80-81`。 | **MOVE 页面聚合；FREEZE 权威权限事实原则**。Web/MCP 从内核有限权限／审批／用量事实及应用声明组合页面；不能用应用自报权限替代执行层事实。不冻结中文 capabilities、today/最近十条审批等页面协议。 |
| **`reference`** → `m_modules_reference`，`packages/engine/src/modules/steward/system/modules.ts:178` | 可选 target；无 target 列所有接口，有 target 给完整契约、admission、routingErrors、contractHash；不执行业务。 | 内核作者提示及构建工具集：`packages/engine/src/modules/steward/module-reference.ts:11-14`。 | **DELETE 重复发现接口**。唯一目录支持“读声明但不执行”的现有需求，区分声明可读范围与执行准入；作者模块负责开发说明。不得以替换为 `modules.tools` 为名丢掉 currently non-callable contracts 的合法开发查阅能力。 |
| **`tools`** → `m_modules_tools`，`packages/engine/src/modules/steward/system/modules.ts:179` | `{query?,audience?:"caller"\|"user"}`；每个词匹配 target/description，按准入筛选；返回 identity/hash/contractHash、输入输出、examples/effects/errors/retry/idempotent。另夹带 stop/revise 构建控制。 | Web 页面工具校验与会话工具发现；MCP tools；notify/events 目录。见 `packages/engine/src/modules/steward/builtin/web/index.ts:57,168`、`packages/engine/src/modules/steward/builtin/web/agent-conversations.ts:79`、`packages/engine/src/modules/steward/external/mcp/index.ts:90-91`、`packages/engine/src/modules/steward/external/events/index.ts:7`。 | **FREEZE 唯一工具／契约目录的最小原则**。保留真实目标身份、声明、执行准入和必要固定目标校验；词搜索与 `audience:user` 展示策略可由模块处理。删除构建控制特判。 |
| **`refresh-health`** → `m_modules_refresh_health`，`packages/engine/src/modules/steward/system/modules.ts:181` | `{module}`；只允许 owner 或 `uses:["*"]` 的 entry 模块；调度诊断 health 事件，返回 readiness。 | Web “重新自检”：`packages/engine/src/modules/steward/builtin/web/index.ts:121`、`packages/engine/src/modules/steward/builtin/web/src/system/detail.ts:55-60`。 | **MOVE**。应用声明普通的只读自检工具，Web 发起同样用户操作；内核不规定业务健康协议。不把自检直接改成可付费、有外部写效果的任意调用。 |
| **`report-health`** → `m_modules_report_health`，`packages/engine/src/modules/steward/system/modules.ts:182` | 模块自报 status/summary/nextAction/validForSeconds，必须是当前连接进程对应 hash；报告仅存 supervisor instance 内存。 | SDK `chrona.reportHealth`；Agent、coding 自检调用。见 `packages/integrations/src/steward/module-sdk/sdk.ts:128-130`、`packages/engine/src/modules/steward/builtin/agent/runtime.ts:58-60`、`packages/engine/src/modules/steward/external/coding/index.ts:25-34`。 | **MOVE** 自报协议。应用自检返回带身份归属的结果，由 Web 管理过期显示；Agent 也可用自己的普通模块工具报告。内核仍提供不可伪造的实际进程／调用观察，但不托管所有应用的“业务 ready”枚举与 TTL。 |
| **`contributions`** → `m_modules_contributions`，`packages/engine/src/modules/steward/system/modules.ts:183` | `{section}`；仅 caller 自己名字对应 section，另允许 approved active entry 读 `memory`；返回 `{module,hash,value}`。 | events 读 events；mind 读 mind；入口 memory provider 发现。见 `packages/engine/src/modules/steward/external/events/index.ts:6`、`packages/engine/src/modules/steward/external/mind/index.ts:157`、`packages/engine/src/modules/steward/builtin/web/memory.ts:59`。 | **MOVE** 接收模块拥有登记协议。events/mind/memory 各自声明普通 registration/discovery 工具，身份来自真实 routed caller；启动／依赖变更后重新登记。删除 kernel 的 `memory` 专用豁免。 |
| **`check`** → `m_modules_check`，`packages/engine/src/modules/steward/system/modules.ts:184` | `{module,hash?,wait:0..600默认0}`；最新或指定版本的结果、reason、report；等待受调用 deadline 限制。 | 构建 Provider 工具；入口会话和 mind Agent 允许此工具。见 `packages/engine/src/modules/steward/module-reference.ts:11`、`packages/engine/src/modules/steward/builtin/web/agent-conversations.ts:80`、`packages/engine/src/modules/steward/external/mind/execution.ts:8`。 | **FREEZE 最小候选结果读取**。显式候选身份、检查阶段／结论／审批引用／受限证据不可省；默认“最新版本”、长轮询、BuildReport 全结构和报告截取长度不应冻结。 |
| **`checkout`** → `m_modules_checkout`，`packages/engine/src/modules/steward/system/modules.ts:185` | `{module,hash?,dir,source?:"stored"\|"builtin"}`；只向 Provider 当前 cwd 的空目录复制源代码。 | 构建工具集及作者说明：`packages/engine/src/modules/steward/module-reference.ts:11-14`；实际绑定 run.cwd：`packages/engine/src/modules/steward/system/modules.ts:59-84`。 | **PRIVATE 当前宿主物化实现；FREEZE 必要的已存版本源读取原则**。作者／分发模块先读指定版本的不可变源码，再在自己的目录物化。保留 source 可读性，不永久冻结 Provider-only cwd 和 `builtin` release 特例。 |
| **`propose`** → `m_modules_propose`，`packages/engine/src/modules/steward/system/modules.ts:186` | `{dir,intent:{changes,preserves}}`；Provider cwd 受限快照，构建还核对授权目标与提交上限；返回 candidate 身份及结果。 | 构建工具集；官方 install 的内部提交流程复用 `propose` 函数。见 `packages/engine/src/modules/steward/module-reference.ts:11`、`packages/engine/src/modules/steward/module-install.ts:42-47`。 | **FREEZE 核心提交原则，重做最小入口**。固定候选、真实提交者、目标授权、预期版本、检查和结果归属；目录读取／release 获取为宿主私有。必须使获授权的作者／分发模块能提交自己拥有的材料；不能只移走流程而保留 Provider-only 门禁。 |
| **`rollback`** → `m_modules_rollback`，`packages/engine/src/modules/steward/system/modules.ts:187` | `{module,hash}`；限已批准版本；相同数据 schema 可直接切换，恢复旧快照要审批；返回 active 或 pending_approval。 | Web POST rollback；rescue；CLI。见 `packages/engine/src/modules/steward/builtin/web/index.ts:126`、`apps/server/src/rescue.ts:42`、`packages/cli/src/admin.ts:21-23`。 | **FREEZE** 安全版本选择／恢复原则；可并入同一受治理版本切换入口，但不能丢失恢复时的数据丢失审批和快照绑定。UI 文案和“推荐哪个版本”由模块负责。 |
| **`disable`** → `m_modules_disable`，`packages/engine/src/modules/steward/system/modules.ts:189` | `{module,reason}`；暂停进程与当时 active schedules，保留数据与版本。 | Web POST disable；CLI disable。见 `packages/engine/src/modules/steward/builtin/web/index.ts:123`、`packages/cli/src/admin.ts:18`。 | **FREEZE** 受治理停止／暂停原则。实际停止、未知执行和计时器一致性不能由被暂停模块自我承诺。reason 展示和按钮流程不是内核永久协议。 |
| **`enable`** → `m_modules_enable`，`packages/engine/src/modules/steward/system/modules.ts:189` | `{module,reason}`；恢复 paused 模块及上次 disable 暂停的 schedules，不恢复用户独立暂停的 timer。 | Web POST enable：`packages/engine/src/modules/steward/builtin/web/index.ts:124`。 | **FREEZE** 受治理启用原则；保留暂停归属，不冻结过期 one-off 与 recurring 的具体业务补跑策略。 |
| **`remove`** → `m_modules_remove`，`packages/engine/src/modules/steward/system/modules.ts:189` | `{module,reason}`；返回删除审批；批准后备份并删除数据、content、版本、settings、撤销 module grants。拒绝 builtin、通常拒绝 entry，MCP 特例可删。 | Web POST remove：`packages/engine/src/modules/steward/builtin/web/index.ts:125`。 | **FREEZE** 删除信任边界；**DELETE** Web/Notify intrinsic protection、MCP 专名豁免。普通模块包括 Web/Notify 可删除／替换，但仍保留 owner 决定、备份、依赖／in-flight／unknown 守卫和审批后重检。 |
| **`build`** → `m_modules_build`，`packages/engine/src/modules/steward/system/modules.ts:190` | name 或 modules[1..4]，goal/examples/files/intent/cause；创建独立 AI 作者会话；FIFO、每日额度、重复合并、回执。 | Web/QQ/MCP 会话预置工具集；mind 自主修复流程。见 `packages/engine/src/modules/steward/builtin/web/agent-conversations.ts:79-80`、`packages/engine/src/modules/steward/external/qq/agent-conversations.ts:79-80`、`packages/engine/src/modules/steward/external/mcp/agent-conversations.ts:79-80`、`packages/engine/src/modules/steward/external/mind/execution.ts:6-8`。 | **MOVE 作者流程**。作者模块用 Agent 完成编写／测试／续写，调用最小内核候选提交和结果读取。内核继续执行 Run 预算与目标／提交授权；不冻结 goal/examples/cause、构建会话类型及修复去重策略。 |
| **`build-sessions`** → `m_modules_build_sessions`，`packages/engine/src/modules/steward/system/modules.ts:191` | `{limit?:1..100}`；返回 targets/status/times/queue，不含 prompt、host path 或 Agent context。 | Web 会话列表与系统页；MCP 会话列表。见 `packages/engine/src/modules/steward/builtin/web/index.ts:70`、`packages/engine/src/modules/steward/builtin/web/app-overview.ts:14`、`packages/engine/src/modules/steward/external/mcp/index.ts:42`。 | **MOVE** 作者模块的工作列表。作者模块持有自己的工作记录，关联 Agent 和 candidate 句柄；Web/MCP 用其工具显示同样记录。 |
| **`build-session`** → `m_modules_build_session`，`packages/engine/src/modules/steward/system/modules.ts:192` | `{session}`；一个构建加最近最多 50 个 run facts。 | Web 非 Agent 会话 messages 分支；MCP `chrona_session`。见 `packages/engine/src/modules/steward/builtin/web/index.ts:84`、`packages/engine/src/modules/steward/external/mcp/index.ts:45`。 | **MOVE**。保留用户查看构建状态，数据由作者模块和 Agent 自有接口提供；不公开 kernel 专属“build session”永久类型。 |
| **`build-transcript`** → `m_modules_build_transcript`，`packages/engine/src/modules/steward/system/modules.ts:193` | `{session}`；最多 100 条标准化脱敏 transcript。 | Web transcript；MCP transcript。见 `packages/engine/src/modules/steward/builtin/web/index.ts:83`、`packages/engine/src/modules/steward/external/mcp/index.ts:57`。 | **MOVE** 作者模块＋Agent。必须先提供授权读日志路径和脱敏保证，不能以减少内核为由把 host sessionDir 暴露给 Web。 |
| **`build-settings`** → `m_modules_build_settings`，`packages/engine/src/modules/steward/system/modules.ts:194` | `{limits?:Partial<{dailyLimit,timeoutMinutes,maxSubmissions}>}`；读取／更新限制和今日 use。 | Web Settings GET/POST：`packages/engine/src/modules/steward/builtin/web/settings.ts:11,31`。 | **MOVE 默认作者业务额度；FREEZE 实际执行／授权预算的执行原则**。用户仍能控制作者模块的日额度；Agent/内核执行不能依赖应用自觉遵守 owner 上限。不应冻结“每日新 build session 次数”作为内核通用概念。 |
| **`request-group`** → `m_modules_request_group`，`packages/engine/src/modules/steward/system/modules.ts:196` | `{versions:[{module,hash}]}`，2..4 个，必须恰好覆盖调用构建声明的目标；需要数据迁移的成员拒绝；整体切换。 | 构建工具集和 group 作者提示：`packages/engine/src/modules/steward/module-reference.ts:11`、`packages/engine/src/modules/steward/module-build-session.ts:179-180`。 | **FREEZE 已有原子批量切换必要性；MOVE “一个构建声明几个模块／何时请求”流程**。批量候选必须先被内核登记为一个受治理集合；不能删掉 group 后依次 auto-activate，或让普通模块用循环调用假装原子。 |
| **`stop-build`** → `m_modules_stop_build`，`packages/engine/src/modules/steward/system/modules.ts:197` | `{session}`；停止 queued/running，不撤回已提交版本与审批。 | MCP 泛工具显式允许；目录搜索特判加入。见 `packages/engine/src/modules/steward/external/mcp/index.ts:98-100`、`packages/engine/src/modules/steward/system/modules.ts:133-137`。 | **MOVE** 作者工作操作；底层 Agent／内核取消与实际停止证据保留。UI 必须继续说明“停止作者执行 ≠ 撤销候选或审批”。 |
| **`revise-build`** → `m_modules_revise_build`，`packages/engine/src/modules/steward/system/modules.ts:197` | `{session,requirements,files?}`；先验证文件，再停旧 run，同 cwd 尾部排新 run。 | MCP 泛工具允许；构建工具目录特判。见 `packages/engine/src/modules/steward/external/mcp/index.ts:98-100`、`packages/engine/src/modules/steward/system/modules.ts:133-137`。 | **MOVE** 作者模块续写流程。保留旧 run 停止确认、参考材料先解析、已有审批不变与未知结果不重放；不冻结 request.json、沿用 cwd、旧 prompt 累加等作者实现。 |

### 3. 三个容易被注册描述误导的事实

**① `uses` 通常不是运行时逐目标 allowlist。**

```ts
if (tool.visibility.includes("modules")) return true;
...
return !!manifest && grantedUses(manifest).includes("*");
```

`admitted(db: Db, caller: Caller, tool: RoutedTool)` 位于 `packages/engine/src/modules/steward/module-calls.ts:158-164`。因此不能把 `uses` 全部当成运行时权限，或将它的所有内容永久提升为权限契约。

**② Provider “请求启停需要 owner 决定”的注释不符合当前函数行为。**

`createModules().lifecycle()` 对非 asUser 的启停调用 `requestStatus`，但：

```ts
return context.db.$transaction(async tx => {
  const result = await setStatusIn(...);
  ...
  return result;
});
```

`requestStatus(context: ModuleContext, moduleId: string, status: ModuleStatus, reason: string)` 实际直接改变状态。证据：`packages/engine/src/modules/steward/modules.ts:135-142`、`packages/engine/src/modules/steward/module-status.ts:74-85`。冻结依据应是当前代码及用户选定策略，不能依据旧注释。

**③ “所有 entry 更新必须 owner 批准”的注释也不是当前通用逻辑。**

`requestReview` 在非 group、无实际数据迁移、无新增 credentials 时调用 `activateChecked` 自动激活；entry 身份没有出现在这条拒绝条件中。证据：`packages/engine/src/modules/steward/module-build.ts:116-125`。相反，`isEntryModule` 前后的注释仍称每个版本都要 owner：`packages/contracts/src/steward/index.ts:265-273`。

### Inferences

- 31 个工具不应按“当前有 caller”全部保留。多个 caller 只是依赖现有内核投影，并不要求该投影永久属于内核。
- 删除工具前必须迁移真实页面与入口行为；特别是构建状态／transcript、轻量健康分页、源码获取和检查结果，不是可随意丢弃的“管理便利功能”。
- 暂未找到某工具的具名生产直调不等于死代码：公开 routed handler 本身仍可达。`upstream` 应按工作流归属迁移，不应仅以“未搜到 caller”宣布无用途。

### Gaps

- 未运行真实用户工作流；以上 caller 证明生产代码路径存在，不证明生产部署使用频率。
- 未读取凭据或实际数据库，无法统计安装／构建记录的真实数量。
- 未对所有动态 Agent 工具选择做运行时追踪；Provider 声明与工具目录足以证明可调用面，但不能证明某次模型确实调用过。

---

## 二、哪些内核边界不可移走，哪些 schema 会永久固化错误政策？

### Takeaway

普通模块可以拥有“作者、安装器、设置页、自检和聚合”，但不能批准自身代码、替换自身真实身份、保证跨模块原子切换、宣告未知执行已停止，或在不持有宿主权限时安全处理平台数据恢复。应保留这些边界，避免把与它们相邻的整套工作流一起冻结。

### Cited Findings

### 1. 不可移走的版本与数据治理链

#### A. 候选材料必须由内核绑定为固定版本

关键签名：

```ts
export async function propose(
  context: ModuleContext,
  input: ProposalInput,
  source: ModuleSource
): Promise<Proposal>
```

实现：`packages/engine/src/modules/steward/module-proposal.ts:126-130`。

当前链条包含：

1. 从受限 root/dir 读取快照；
2. 验证 manifest 和 entry/migrate 文件；
3. 校验目标名字、身份及构建授权目标；
4. Git 固定源码与 revision；
5. 建立 durable ModuleVersion；
6. 后台检查后才允许选中。

证据：`packages/engine/src/modules/steward/module-proposal.ts:57-65,73-119,131-149`。

宿主文件约束不是应用工作流：禁止绝对路径、`.`/`..`/`.git`、符号链接、多硬链接；限制文件数及总大小，`O_NOFOLLOW` 读取。证据：`packages/engine/src/modules/steward/module-files.ts:6-31,34-73`。

**为何普通模块不能替代：** 提交者不能自行证明“执行中的字节与通过检查的字节相同”。尤其 required-isolation 下，它也不应拥有平台 store 或其他模块文件的宿主路径。文件检查与材料固化留在内核／宿主；作者生成材料可在模块。

**不应冻结：** Git 必须是公开版本身份、固定 40/64 位 hash 兼容、root/dir API、200 文件／1 MiB 数值、provider/user/build 三种 source，以及 intent 的文案结构。这些是当前实现／产品选择，而非不可变安全公理。

#### B. 检查不能由提交者自报通过

`checkBuildCandidate` 实际执行依赖安装、TypeScript 检查、离线作者测试、数据副本连续性与启动／SDK 探测，最后安装内核拥有的不可变副本。证据：`packages/engine/src/modules/steward/module-build.ts:178-200`。

检查连续性：

```ts
export async function checkContinuity(
  context: ModuleContext,
  staging: string,
  module: Module,
  manifest: Manifest,
  continuity: ContinuityReport
)
```

数据 schema 降级拒绝；非空数据升级要求 migrate；迁移和作者测试运行于副本；副本测试的 stdout/stderr 不公开。证据：`packages/engine/src/modules/steward/module-continuity.ts:35-75`。

启动检查明确仅验证 loading/SDK connection，不验证业务恢复：`packages/engine/src/modules/steward/module-probe.ts:8-16`。

**为何普通模块不能替代：** 候选作者和候选本身都不是自身准入的可信裁判；它们可提供 tests，但检查结果与执行材料必须由内核绑定。编译器、包管理器、探测子进程等细节可私有化，不成为公开可替换“第三类能力”。

**应冻结的语义：** 检查覆盖什么、结果与哪一固定候选绑定、哪些项目尚未知；不能只返回笼统 success。

#### C. 自动激活、审批与实际切换需在同一受控链条

自动激活在事务内重读 activeHash/status，批准候选、更新 dataSchema、调用 `activateIn`，并留下 audit。证据：`packages/engine/src/modules/steward/module-build.ts:100-114`。

```ts
export async function switchActiveIn(
  context: ModuleContext,
  tx: Prisma.TransactionClient,
  moduleId: string,
  hash: string,
  {
    preserveSchedules = false,
    preservePause = true,
    operation = "activate"
  }: {
    preserveSchedules?: boolean;
    preservePause?: boolean;
    operation?: "activate" | "rollback";
  } = {}
)
```

切换前检查身份、执行 idle、候选 approved、listen 冲突；同事务更新 schedules 与 activeHash。证据：`packages/engine/src/modules/steward/module-generation.ts:60-82`。

审批核验不是“拿到一个 approvalId 即可”：

```ts
if (!approval ||
    JSON.stringify(approval.payload) !== JSON.stringify(action.payload))
  throw new StewardError("conflict", "Module approval does not match");
```

证据：`packages/engine/src/modules/steward/module-activation.ts:21-24`；group 同样核验：`packages/engine/src/modules/steward/module-group.ts:131-135`。

**为何普通模块不能替代：** 多个进程无法自行建立全局唯一的当前版本和原子状态；拥有普通 routed call 权限不等于拥有 approval authority。模块可提出切换请求，不能让自己的“已授权”参数成为授权来源。

#### D. 原子 group 是当前实际需求，不是预留框架

当前 `build.modules` 接受 1..4 个目标，`request-group` 要求精确覆盖；每个成员必须是同一构建提交、pending_review、已检查且无需数据迁移。证据：`packages/contracts/src/steward/index.ts:578-604`、`packages/engine/src/modules/steward/module-group.ts:57-82`。

无新增 secrets 时，group 在一个 DB 事务中批准所有成员、切换所有成员，并记录一个 generation；审批 group 同样整体事务执行。证据：`packages/engine/src/modules/steward/module-group.ts:85-101,131-144`。

**不可误删：** 如果移走作者流程后仍沿用“单候选检查通过立即激活”，跨模块改动会先激活部分成员，丢失当前用户承诺。最小批量提交必须在检查完成前就绑定整体激活方式，不能事后用普通模块逐个 `propose` 拼出来。

**不应冻结：** “恰好是同一 build session”“2..4 个”“group review 前缀／后缀共享 20,000 字符”这些作者和 UI 细节。保留一次受治理集合的 all-or-none 切换，不建立通用事务工作流框架。

#### E. 迁移不是单一 DB 事务，恢复协议必须保留

```ts
export async function migrateData(
  context: ModuleContext,
  prepared: PreparedMigration,
  reason: "activate" | "rollback",
  restore?: Restore
)
```

实现使用 `data-next`、`data-old` 与 live 目录交换；检查迁移所有权、保留 pre-swap 数据直到 DB commit；失败做补偿；崩溃恢复会恢复旧数据。证据：`packages/engine/src/modules/steward/module-migration.ts:13-28,64-113,114-129`。

**为何普通模块不能替代：** 模块只拥有自己的私有目录，不拥有其他版本激活及平台状态；普通模块也不能跨文件系统和内核 DB 自己保证恢复原子性。迁移脚本由应用编写，执行／审批／数据交换和恢复由内核主持。

**冻结阻塞，具体源码矛盾：** `withMigrationOwner` 的 writer-lock 条件写死：

```ts
builtin: false
```

位置：`packages/engine/src/modules/steward/module-migration.ts:24`。当前身份规则允许 web/notify 动态生命周期，但此迁移守卫仍以 builtin false 限定所有权。按用户决定把 Web/Notify 变成普通模块可消除此类别冲突；在那之前不能宣称它们所有迁移路径与普通模块一致。

#### F. 回滚必须明确代码回退与数据恢复不同

`prepareRollback`：

- approved 版本才可选；
- schema 相同或数据为空时直接切换；
- 旧 schema 需要匹配快照及用户审批；
- restore approval 绑定 schema/snapshotAt，批准后再次验证快照未改变。

证据：`packages/engine/src/modules/steward/module-activation.ts:30-44,64-95`。

自动启动失败回滚也有严格范围：未验证过成功能力、未发生迁移／restore、静态 schedules 兼容、未使用动态 timers、非 group、当前激活仍一致，且只尝试一次。证据：`packages/engine/src/modules/steward/module-generation.ts:136-213`。

**建议：** 自动回滚资格与重试上限留作内核私有策略；公开保留“发生了什么、数据如何处理、当前版本是什么、效果是否未知”，不永久冻结整个自动恢复状态机。

#### G. 删除必须由内核执行，而不是应用删除自己

```ts
export async function requestRemove(
  context: ModuleContext,
  moduleId: string,
  reason: string
)

export async function removeApproved(
  context: ModuleContext,
  action: ApprovedAction
)
```

证据：`packages/engine/src/modules/steward/module-remove.ts:70-79,83-125`。

删除前检查：

- 执行 idle、非 migrating；
- 依赖模块；
- 活跃会话和 queued/running 工作；
- queued/running/waiting/unknown invocation、未处理 callback；
- 未核实 ModuleCall。

批准后重检 payload、active hash，再暂停并 settle，备份 data/content/code/repository；备份后再次事务核验，撤销 grants、删 settings 和 module row，最后删除私有目录。证据：`packages/engine/src/modules/steward/module-remove.ts:24-68,85-125`。

**为何普通模块不能替代：** 被删除者不能判定别人是否仍引用它，不能安全清理全局授予和路由身份，也不能保证自己结束后继续完成恢复工作。

**必须删除的现有政策：**

- builtin Web/Notify 不可删除；
- “入口应用默认都不可删除，只有名叫 mcp 的 external 例外”。

证据：`packages/engine/src/modules/steward/module-identity.ts:10-18,30-33`、`packages/engine/src/modules/steward/module-remove.ts:29`。

替代应是普通模块的相同可删除规则；保留依赖和 in-flight 守卫。Web 删除后的可操作性由宿主 rescue/stopped CLI 保底，而不是把 Web 的名字永久提升为信任根。

#### H. 未知停止仍是硬边界

```ts
export async function assertExecutionModuleIdle(
  tx: Prisma.TransactionClient,
  moduleId: string
)
```

它会拒绝 queued/running、`error: "Execution stop is unconfirmed"` 的 Agent run，以及仍有 `heldDirectory` 的 executionAttempt。证据：`packages/engine/src/modules/steward/execution-module-guard.ts:5-12`。

**为何普通模块不能替代：** 只有执行治理层拥有实际 attempt、目录占用和 stop evidence；应用自报“已经取消”不能使版本切换或数据删除变安全。

### 2. 构建流程中应该分离的三层内容

此处“三层”是职责分解，**不是新增实体类型**；实体仍只有内核和模块。

| 内容 | 当前位置 | 建议归属 |
|---|---|---|
| 默认作者提示、manifest 帮助、例子、参考文件布局、active 源码复制、诊断快照、model tier 文案 | `packages/engine/src/modules/steward/module-build-session.ts:146-181` | 作者模块 |
| 构建会话、goal/examples、request.json、cause 合并、修订 prompt、尾部排队、工作列表 | `packages/engine/src/modules/steward/module-build-session.ts:187-267,270-320` | 作者模块；执行仍经 Agent/内核治理 |
| 真实提交者、授权目标、提交上限、模型预算、deadline、未知停止 | 当前 Run 授权与生命周期治理；当前合同见 [Author/Agent 创作](../../docs/zh/author-current-conversation.md) | 内核执行／生命周期强制边界，当前 Agent 在已有 Run 内执行 |

关键误区：`cause:{moduleId,activationId,incidentId|topic}` 是 **mind 自主修复去重策略**，不是通用内核构建授权。`outstandingCause` 会跨会话查同 cause 的 outstanding build 并复用。证据：`packages/engine/src/modules/steward/module-build-session.ts:205-218`；实际 mind 协议明确要求传 cause：`packages/engine/src/modules/steward/external/mind/execution.ts:6-8`。这应由 mind／作者模块协商，不应永久冻结为内核字段。

### 3. 当前创作与独立救援的边界

当前 Agent 在已有 Run 中开发、安装依赖、构建和验证；Author 只接收、导出和提交精确材料，不拥有编译器或额外执行队列。完整源码、锁、构建输入、制品字节和可执行模式继续校验，见[当前对话创作](../../docs/zh/author-current-conversation.md)与[版本材料](../../docs/zh/author-version-materials.md)。

停服救援保留诊断、回滚、启停与精确审批等现有管理能力，写操作仍取得运行锁；不保留额外的模型构建执行器。未知外部效果查询原固定回执，停止状态不明时继续保留占用，不能借救援绕过授权或检查。

### 4. manifest、SDK 与生命周期字段逐项审查

当前 manifest 主体：`packages/contracts/src/steward/index.ts:176-233`；细化条件：`packages/contracts/src/steward/index.ts:234-262`。

| 当前字段／协议 | 当前用途与证据 | 冻结意见 |
|---|---|---|
| `name` | 路由身份、唯一安装名、保留名守卫。`packages/engine/src/modules/steward/module-identity.ts:6-7,42-47` | **FREEZE 身份语义**；删除 Web/Notify 保留特权，不永久冻结名称长度等实现限值。 |
| `description` | 工具集和目录说明；`packages/engine/src/modules/steward/module-tools.ts:49-50` | 模块元数据，非信任条件；允许存在，不把展示规则冻结为内核义务。 |
| `entry` | 仅支持顶层 ts/py/sh 名称。`packages/contracts/src/steward/index.ts:180` | **PRIVATE 宿主启动格式**；公开冻结可运行材料入口的必要语义，不冻结语言与文件布局。 |
| `triggers[{id,schedule}]` | 激活时重建静态 schedules。`packages/engine/src/modules/steward/module-generation.ts:14-21` | **MOVE 声明式业务定时**；沿用现有模块自有 `schedules.*`。过渡必须迁移现有 timer，不静默删除。 |
| `tools` | 名字、参数、输出、visibility/idempotent；输入输出检查及目录。`packages/contracts/src/steward/module-tool.ts:14-25` | **FREEZE 最小路由契约**；examples/sideEffects/errors 是模块说明，不提升为安全证明。 |
| `keepAlive` | 常驻与空闲启动模式；`packages/contracts/src/steward/index.ts:183-184` | **PRIVATE 运行宿主策略**，或最小已有运行需求声明；不永久承诺特定重启／idle 行为。 |
| `activated` | 自身 hash 或其 `uses` 依赖 hash 变化后投递；持久记录 `platform/activated.json`，最多三次。`packages/engine/src/modules/steward/module-supervisor.ts:321-353` | 保留当前应用登记所需的**最小启动／版本变化通知**；重试数、文件位置、按 uses 签名计算方式私有。不是预留任意生命周期 hook 框架。 |
| `healthCheck`、`health` event、`reportHealth` | 自检事件与 supervisor 内存 readiness。`packages/engine/src/modules/steward/module-supervisor.ts:302-310,471-482` | **MOVE** 应用自检工具；删除普适业务健康枚举和内核 TTL 托管。 |
| `content`、`chrona.paths.content` | 应用私有 content 目录；SDK 路径由环境注入。`packages/integrations/src/steward/module-sdk/sdk.ts:111-116` | **FREEZE 私有存储归属原则**；目录布局和 flag 实现私有。不能改成全局附件命名空间。 |
| `listen` | HTTP 路径、keepAlive 要求、保留路径及活动冲突。`packages/contracts/src/steward/index.ts:190-198,253-255`、`packages/engine/src/modules/steward/module-generation.ts:60-67` | **FREEZE 受治理 HTTP 入口归属与冲突规则**；不授予 Web 名字特殊身份。具体 socket/代理细节私有。 |
| `uses` | 调用契约、依赖变化、类型检查；`*` 另外具 owner audience 意义。`packages/contracts/src/steward/index.ts:200-203`、`packages/engine/src/modules/steward/module-calls.ts:157-164` | 分开冻结“引用契约”和“owner 能力授权”语义，不能把整个 uses 说成 allowlist；删除 `memory` 等业务特判。 |
| `packages` | Nix／系统包名称，依赖安装。`packages/contracts/src/steward/index.ts:205-209`、`packages/engine/src/modules/steward/module-build.ts:44-51` | **PRIVATE 宿主材料／构建细节**；`required-isolation` 当前无法隔离依赖安装会拒绝，不能将“declared package = 隔离安全”写入永久契约。 |
| `contributes` | 任意 JSON，以接收模块名字分区，内核 memory 例外。`packages/contracts/src/steward/index.ts:211-217`、`packages/engine/src/modules/steward/system/modules.ts:110-127` | **MOVE** 接收模块登记协议；不冻结 universal manifest 插件元数据容器。 |
| `secrets` | 可读凭据声明及表单、OAuth provider/URLs/scopes。`packages/contracts/src/steward/index.ts:152-175,219-223` | **FREEZE 凭据授权／使用边界**；表单 UI metadata 与 provider 专属策略不必属于生命周期永久 schema。本题不建议删除凭据治理。 |
| `model:{tier,maxCalls,maxOutputTokens}` | `agent.complete` 对应预算及 owner 配置检查。`packages/contracts/src/steward/index.ts:224-225,256`、`packages/engine/src/modules/steward/module-build.ts:146-153` | **FREEZE 模型预算执行原则**；tier/default 作者政策由 Agent／配置拥有，不因唯一 builtin Pi 而冻结未来 Provider 注册框架。 |
| `effects:["network"]` | 当前唯一 effect；manifest 描述与隔离执行条件有关。`packages/contracts/src/steward/index.ts:226` | 保留实际网络控制需要的声明／执行条件；不得把它描述为 trusted-local 下完整 OS 权限。 |
| `params` | 固定值带重复 type；与 settings 合并给 event.params。`packages/contracts/src/steward/index.ts:142-144,227,237-239` | **MOVE** 应用配置；删除通用固定 param DSL 义务。模块私有配置足够，内核只注入它必须知道的运行信息。 |
| `settings` | number/string/boolean 表单与 defaults，存 workspace.settings.moduleSettings。`packages/contracts/src/steward/index.ts:228-229`、`packages/engine/src/modules/steward/module-overview.ts:91-117` | **MOVE**。应用自有存储和工具；不冻结 universal settings-get/set 与健康刷新耦合。 |
| `limits.virtualMemoryMb` | 地址空间上限 1024..8192，非通用资源预算。`packages/contracts/src/steward/index.ts:230-231` | **PRIVATE 宿主资源选项**；内核保留不能突破 owner／宿主硬限制的原则，不公开永久内存调参产品。 |
| `data:{schema,migrate}` | 数据版本、迁移文件与安全恢复。`packages/contracts/src/steward/index.ts:232` | **FREEZE 数据兼容与迁移审批原则**；具体文件名与脚本协议私有。 |
| `tests` | 必填 1..10 个 ts/py/sh 文件；内核离线执行。`packages/contracts/src/steward/index.ts:233` | **FREEZE 检查材料与可信结果关联**；测试文件布局、语言／数量限制私有。 |
| SDK `on(kind, handler)`、event `params` | schedule/tool/content_edit/call_result/activated/health。`packages/integrations/src/steward/module-sdk/sdk.ts:12-35,99-100` | 只冻结当前必要的调用、定时与启动／结果协议；health 和配置事件字段随迁移退出。不要一次性冻结整个现有 Trigger union。 |
| SDK `chrona.call`、`callStatus` | sync/async、key/reply/timeout、expectedTarget。`packages/integrations/src/steward/module-sdk/sdk.ts:22-34,119-132` | 属最小路由边界；真实身份、未知结果、不自动误重放、目标绑定不可丢失。 |
| SDK `wakeProvider/model/notify` 等 shorthand | `propose.description` 同时携带其默认作者用法。`packages/contracts/src/steward/index.ts:570-571` | 应用便利包装不是生命周期信任根；不应随 manifest/help 大字符串一起永久冻结。 |

### 5. 权限、就绪、自报与观察事实不应混成一套永久 schema

当前 `modulePermissions` 把：

- `addedCapabilities(null,manifest)` 生成的中文描述；
- credentials 配置状态及字段；
- model tier、target、今日 use；
- grants；
- 最近十个 approvals；

聚在一个返回值中。证据：`packages/engine/src/modules/steward/module-overview.ts:16-45`。

其中 `addedCapabilities` 是展示投影，会把 `uses` 输出为“调用 X”，把 packages、listen、network 等统一称 capability；不是 runtime policy 判定结果。证据：`packages/engine/src/modules/steward/module-capabilities.ts:6-18`。

就绪报告则只在 supervisor 内存中存在，关闭／退役／hash 不符或过期后 unknown；不是安装失败，也不解决真实故障。证据：`packages/engine/src/modules/steward/module-supervisor.ts:471-482`、`packages/engine/src/modules/steward/module-readiness.ts:13-17`。

当前 health schema 又包含以下长期义务：

```text
runtime.state / pid
activation.status / observedCapabilities
consecutiveFailures
incident.status / failures / pendingTriggers / revision
contractFailureCount
open / nextAction / truncated
readiness / healthCheck
```

完整定义：`packages/engine/src/modules/steward/module-diagnostics.ts:27-64`。

**建议：**

- 内核负责“哪次真实激活／调用发生何种可观察事实、效果是否未知”。
- 应用负责“ready/needs_configuration”“需不需要提醒”“下一步建议”“自修复 cause 合并”。
- `truncated`／不完整证据语义必须保留；但固定扫描 200 条、返回五条等是查询实现，不是永久政策。
- 不能用“应用自检成功”覆写内核的 unknown delivery 或故障证据。

### 6. 当前存储边界

| 存储 | 当前事实 | 冻结意见 |
|---|---|---|
| `Module` | builtin、activeHash、dataSchema、status，workspace/name 唯一。`prisma/schema.prisma:64-83` | 内核权威身份和选中状态保留；`builtin` 不应继续为 Web/Notify 提供特权。 |
| `ModuleVersion` | manifest/intent/source/report/status 与 module/hash 唯一。`prisma/schema.prisma:85-98` | 内核保留固定候选及检查／授权状态；不公开 Prisma 行作为契约。 |
| `Generation` | 所有模块 active hash 映射与 seq。`prisma/schema.prisma:100-109` | **PRIVATE** 原子激活实现。公开只需核对这次切换及目标版本，不必承诺全局 generation 模型。 |
| `ModuleInvocation` | 真实 caller、callerModuleId/hash、target/tool、key、lease、unknown、callback。`prisma/schema.prisma:142-174` | 路由／身份／未知效果和 in-flight 删除守卫依据，不能迁移到任意管理模块自报。 |
| Audit 中 build_request/targets | 内部构建会话保留目标授权事实，非 writable request.json。`packages/engine/src/modules/steward/module-build-session.ts`。旧 owner build 的 execution 授权已随旧入口删除。 | 当前候选仍由真实提交应用按精确材料准入；内部构建会话的目标约束继续保留。 |
| Audit 中 install/upstream receipts | 官方安装幂等、merge 来源和结果归属。`packages/engine/src/modules/steward/module-install.ts:203-246`、`packages/engine/src/modules/steward/module-upstream.ts:61-95` | 分发模块拥有请求回执；内核候选／切换结果继续作为权威证据。迁移期间不得未知结果重提。 |
| 应用 settings | workspace.settings.moduleSettings。`packages/engine/src/modules/steward/module-overview.ts:108-114` | 应用私有持久化；真实迁移另需明确授权，本审计没有执行。 |
| readiness | supervisor instance 内存。`packages/engine/src/modules/steward/module-supervisor.ts:475` | 应用自检结果，不应为它建立新的内核持久存储。 |

### Inferences

**必须保留为公开最小内核边界的能力，不是当前 31 个名字：**

1. 有权提交者提交固定候选／已有必要的候选集合。
2. 读取候选的可信检查结果、审批需要与最终选中事实。
3. 受治理版本选择／回滚，包括数据迁移与恢复。
4. 受治理启停和删除。
5. 读取安装身份、必要契约与受限观察证据。
6. 正常 routed call 的真实身份、准入、未知结果和目标绑定。
7. owner 授权／预算／停止证据执行。它们不能退化为 prompt 建议。

**必须私有、而不是永久应用合同的实现：**

- Prisma、Generation、Git repository／bundle 导入与 active source 物化；
- staging/store 路径、隔离命令、依赖安装器；
- 自动启动回滚内部 eligibility、恢复扫描、重试次数。

**应移到模块的现有工作流：**

- 默认 AI 作者及修订／会话／transcript；
- 官方包目录、install/update/upstream；
- 应用设置与表单；
- 应用自检及 readiness；
- contributions 登记与业务聚合；
- 权限页、健康关注页及“下一步”建议。

### Gaps

- 本次未审计所有 secrets/OAuth、schedules、Agent 内部字段；上述只界定它们进入生命周期的边界，不能据此宣称其完整 schema 已适合冻结。
- 当前 group 对新增 OAuth 定义的检查值得单独核对：单版本 `addsCredentials` 调用 `addsOAuthDefinitions`，group `groupMember` 的 `addsSecrets` 只比较 secret names。证据：`packages/engine/src/modules/steward/module-build.ts:93-98`、`packages/engine/src/modules/steward/module-group.ts:68-71`。这是冻结前需解决的授权一致性问题；本次未执行测试确认具体 OAuth 变更样例。
- 当前 CLI rollback 仅接受 64 位 hash，而公共版本 schema 接受 40 或 64 位。证据：`packages/cli/src/admin.ts:19-20`、`packages/contracts/src/steward/module-lifecycle.ts:13`。源码现已使用 Git commit 身份；stopped 管理路径不能未经处理就作为完备救援保证。

---

## 三、推荐的唯一最小架构，以及冻结前必须解决的阻塞

### Takeaway

推荐“内核负责准入与状态转移，模块负责作者与分发”，不增设 runtime-capabilities 第三实体，不构建未来 Provider 注册框架。Web/Notify 完全退回普通预装模块，Agent 是唯一在本题涉及的可信内置应用例外。

### Cited Findings

### 1. 最小推荐架构

```text
Web / MCP / QQ / mind
       │ 普通 routed calls，真实 caller
       ▼
作者模块 / 软件分发模块 / 各应用自己的 settings、自检与登记工具
       │
       ├─ Agent：Pi 执行、上下文与执行操作
       │
       └─ 内核：
          安装身份和目标契约
          固定候选或既有必要的原子候选集合
          可信检查、精确审批、受治理切换
          启停、删除、迁移/恢复、实际停止守卫
          有限可信结果和观察证据
```

这不是另建一套通用生命周期框架。当前代码已存在这些内核机制，只需在冻结前去掉混在其上的具体作者／官方分发／表单协议。现有 core 实现入口可见 `createModules` 的 propose/buildPending/activate/onApproved/rollback/lifecycle，证据：`packages/engine/src/modules/steward/modules.ts:108-143`。

#### 公开面只保留必要的“小合同”

不在本报告擅定新 API 名称；冻结前应针对以下合同设计最小 schema：

| 合同 | 必需公开承诺 | 明确不包含 |
|---|---|---|
| 安装／目标目录 | module identity、当前选中版本、启停状态、工具声明、执行 audience／必要目标绑定 | builtin/external 产品分组、宿主 backend、作者 session、recent five runs |
| 不可变源读取 | 合法可读的指定版本材料，不返回平台宿主路径 | Provider cwd、release 目录、Git 仓库操作 API |
| 候选提交 | 实际 caller、固定材料、被授权目标、预期当前状态、单项／已有必要批量激活方式、稳定 receipt | goal/examples、作者 prompt、软件包 registry、任意 host path |
| 检查／切换结果读取 | 固定候选、检查结论、审批引用、最终状态、必要证据、不完整／未知语义 | 全 BuildReport 固定结构、编译器内部格式、作者 transcript |
| 启停／版本选择／删除 | 权限、精确目标、必要审批、in-flight／未知停止守卫、数据处理结果 | Web/Notify 专名保护、MCP 专名删除豁免、管理页面文案 |
| 观察事实 | 身份／激活归属、实际进程和调用失败、unknown effect、必要有限历史 | 自报业务 ready、mind 关注策略、nextAction 中文策略、通用健康产品 |

所有 application-facing 操作继续走同一 routed caller 机制。不能用“作者模块有权限”替换具体 owner 授权，也不能给分发模块平台目录通行权。

#### 正常构建用户路径不消失

用户对 Web/QQ 说“修改应用”：

1. 入口根据上下文选择作者模块，选择可见可改。
2. 作者模块通过 Agent 工作，自己保存需求、参考材料、日志和修订。
3. 内核对被授权目标和提交预算进行强制约束。
4. 作者提交固定候选；内核执行现有检查链。
5. 无需额外决定时按当前选定政策激活；涉及真实数据迁移／新凭据等时，内核要求精确 owner 决定。
6. Web/MCP 从作者记录、Agent 状态和内核候选事实组成结果页。

**不再由内核决定：** prompt、examples、cause、构建日 session 额度、同目录续写、默认三／四个目标限制。

#### 安装／更新用户路径不消失

用户浏览软件目录：

1. 分发模块列出可用软件及来源。
2. 用户明确选择 install 或 update。
3. 分发模块获取／合并自己的候选材料，并保存请求 key 与 receipt。
4. 内核只接收固定候选并检查真实目标；不能绕过检查。
5. 查询内核候选结果后，分发模块更新安装 UI。
6. 不确定提交只核对原 receipt，不无条件重提。

这保留当前 `module-install` 的重要安全行为，但不把 `OFFICIAL_EXTERNAL_MODULE_NAMES` 永久纳入内核公开 schema。当前 enum 证据：`packages/contracts/src/steward/module-lifecycle.ts:9-11,33-49`。

#### 应用自检与设置用户路径不消失

- Web “设置”调用该模块 owner 可见设置工具，数据留在模块私有区域。
- Web “重新自检”调用应用声明的只读工具。
- 页面把自报结果标为应用报告，与内核 observed state 分开。
- 权限页从可信 grants／approvals／预算事实与模块声明组合，应用不能自报自己被授予了什么。
- 业务 registration 由接收模块管理，以 authenticated caller 为源；启动／依赖变化后重新登记。

当前 Web 已经自行组合 overview，而非只能消费内核整页：`packages/engine/src/modules/steward/builtin/web/app-overview.ts:17-34`。这证明迁移聚合不要求新建内核 UI 框架。

### 2. 硬冻结阻塞清单

以下未解决前，不应声称生命周期公开面已经可以永久只增不减。

| 阻塞 | 当前证据 | 冻结前必须做出的决定／最小处理 |
|---|---|---|
| **Web/Notify 仍拥有内置专名和不可删除身份** | `packages/contracts/src/steward/module-lifecycle.ts:8`；`packages/engine/src/modules/steward/module-identity.ts:7,30-33` | 按用户决定改为普通预装模块；Agent 例外独立保留。不能冻结现有 builtin origin/capabilities。 |
| **第三实体“local capability”泄漏到公开目录** | `packages/contracts/src/steward/module-lifecycle.ts:6-7`；`packages/engine/src/modules/steward/system-apps.ts:24-29` | `runtime-callback`／`workspace-local` 回到内核私有实现或普通模块所属接口；不作为第三实体公开。 |
| **把构建编排搬到模块后，模块无法提交候选** | `workspaceTool` 除 build live context 特例外要求 provider；`propose` 在 provider cwd。`packages/engine/src/modules/steward/system/modules.ts:68-89` | 在现有必要范围内开放受治理提交：真实 caller、自有材料、明确目标授权、预算。不能只删 build 后留下无法运行的替代方案。 |
| **单候选自动激活会破坏批量原子性** | `packages/engine/src/modules/steward/module-build.ts:116-125`；group 依赖 build session 审计：`packages/engine/src/modules/steward/module-group.ts:31-35` | 在提交／检查前绑定已有必要的集合激活；移除对“作者会话”身份的依赖。 |
| **授权语义混淆：uses ≠ 一般运行时 allowlist** | `packages/engine/src/modules/steward/module-calls.ts:157-164` | 明确公开权限合同；不要把模块元数据与 runtime admission 混写。 |
| **业务 settings/readiness/contributions 泄漏内核** | `packages/engine/src/modules/steward/module-overview.ts:64-117`；`packages/engine/src/modules/steward/module-readiness.ts:4-24`；`packages/engine/src/modules/steward/system/modules.ts:110-127` | 先迁移真实 caller 至模块工具，再移除旧 schema 和 SDK 字段。 |
| **目录重复且受众语义不同** | tools：`packages/engine/src/modules/steward/system/modules.ts:128-156`；reference：`packages/engine/src/modules/steward/module-reference.ts:17-62`；interfaces：`packages/engine/src/modules/steward/system-apps.ts:23-37` | 合并唯一目录，但保留开发所需声明读取与执行准入的区别；不强迫全工具元数据一次返回。 |
| **健康投影永久固化恢复策略** | `packages/engine/src/modules/steward/module-diagnostics.ts:27-69` | 提取最小内核事实；open/nextAction/业务 ready 留在模块。保留 unknown 与 truncated 语义。 |
| **官方包和 GitHub 上游限制进入内核合同** | `packages/contracts/src/steward/module-lifecycle.ts:33-49,60-64`；`packages/engine/src/modules/steward/module-upstream.ts:18` | 移到分发模块；内核只接收候选和目标，不设计未来 package registry framework。 |
| **离线 CLI 回滚与基线 hash 格式不一致** | `packages/cli/src/admin.ts:19-20`；`packages/contracts/src/steward/module-lifecycle.ts:13` | 修正并静态／受控验证救援路径后才依赖它支持可删除 Web。此次未修改。 |
| **迁移所有权写死 builtin:false** | `packages/engine/src/modules/steward/module-migration.ts:24` | 先统一 Web/Notify 普通身份与迁移链；避免冻结后维护身份例外。 |
| **group 新 OAuth 定义审批可能与单项不同** | `packages/engine/src/modules/steward/module-build.ts:93-98`；`packages/engine/src/modules/steward/module-group.ts:68-71` | 对齐精确 credential/OAuth 变更审批；不能在移动 orchestration 时放大现有差异。 |
| **prompt 和注释残留已移除／错误能力** | `BUILD_REFERENCE_PROMPT` 仍提“五个 built-in”、旧保护规则：`packages/engine/src/modules/steward/module-reference.ts:14`；propose 长说明含旧 `content/chat/`、`provider.complete` 等：`packages/contracts/src/steward/index.ts:570-591`；entry 审批注释与代码不符：`packages/contracts/src/steward/index.ts:265-273` | 清理而非 grandfather。默认作者说明归模块，不应作为内核 schema 描述永久承担兼容义务。 |

### 3. 不能采用的“伪最小化”方案

1. **把整个 `createModules` 包成一个 trusted 管理模块，然后称内核已经很小。**  
   只是搬家，公开政策与特殊身份不减少；管理模块若直接改 DB/store，仍掌握内核权限。

2. **只保留一个泛化 `manage(action,args)`。**  
   工具数量下降，不等于公开义务下降；当前 31 项语义仍然全部存在，甚至失去结构化边界。

3. **普通安装器提交“已测试／已授权”JSON，让内核直接切换。**  
   丢失固定材料、可信检查、审批 payload 与身份绑定。

4. **将所有健康逻辑移走，连进程失败／未知效果也改为应用自报。**  
   应用恰在故障时不能可靠报告；会丢失实际停止和删除守卫依据。

5. **保留现有所有 manifest 字段，只把解释放到模块。**  
   `settings/contributes/healthCheck` 等字段仍被内核校验、存储、投递、读取，永久义务没有消失。

6. **为未来多个 Providers／远程 host 建通用注册框架。**  
   本次只需 Agent 的现有可信边界、Pi 唯一内置实现；未来 providers 向 Agent 注册是方向，不是当前额外框架授权或必要冻结面。

### Inferences

**本题建议永久冻结的最小内核原则是：**

> 内核唯一掌握模块真实身份、路由准入及当前版本；只接受有权提交者的固定候选，在可信检查及必要的精确 owner 决定之后，以单项或已有必要的原子集合切换；涉及执行、数据迁移、恢复与删除时，维护实际停止、未知效果和恢复证据。模块负责如何创作、获取、配置、解释与呈现这些操作。

这保留了当前真正不能委托给普通模块的能力，同时允许以后更换作者、软件来源、Web、通知、健康策略和应用配置，而不修改内核永久合同。

### Gaps

- 这是边界审计及冻结建议，不是完成迁移的验收报告。
- 未执行测试，按任务明确禁令仅做静态研究。
- 将应用设置和作者记录迁入私有数据、改变 Web/Notify 身份涉及持久数据兼容；本报告不授权真实数据迁移、服务重启或部署。
- 对每个 FREEZE 原则还需要一次**最小 schema 审议**；不能把本报告表中的建议重新解释为“现有名字与返回字段全量获准冻结”。