# 工作成果解耦：阶段 A 契约与兼容设计

状态：**阶段 A 与发布迁移基线修复已验证；B1 存储和共享用例已完成本地实现与验证。下一步 B2：正式鉴权接入、受控上传及 MCP/HTTP 入口。B1–B3 本地实施已获批准，但外部成果闭环尚未交付。**

授权记录：用户选择“批准本地实施阶段 B”，允许本地存储、权限契约、成果接入与审阅界面及隔离测试；不允许线上数据修改、实际凭据签发、部署、启动实际 Agent 或改动 Provider 协议。该授权不因发布基线修复而丢失；用户另已授权执行本地基线修复。

依据：[产品架构](./product-architecture.md)。本文是该架构阶段 A 的技术交付，不是另一份产品路线图。

## 1. 阶段 A 范围与当时完成情况（B1 现状见第 10 节）

- 已核验 `AGENTS.md` 将产品架构列为必读，并保留相关开发约束。
- 已对照源码确认成果、附件、验收及 Goal 接续的 Run 绑定。
- 已将现有发现、证据、交付物种类/呈现 schema 提取到 `packages/contracts/src/results/content.ts`；现有 API 复用原对象，运行时贡献类型从同一 schema 推导。
- 既有 HTTP 执行动作、MCP 节点完成和三项结果子 schema 的 JSON Schema 指纹保持不变。
- 新入口、TaskResult 表、外部附件上传、独立成果审阅和 UI **均未交付**。阶段 A 未修改持久化；随后按授权修复了发布迁移资源及校验逻辑，最终应用 schema 不变。未修改权限集、Provider 协议、运行状态机或部署，也未升级用户数据库。

## 2. 源码事实与必须解除的绑定

| 位置 | 当前事实 | 本切片的处理 |
| --- | --- | --- |
| `packages/contracts/src/api/result.schema.ts` | 语义内容与 `generated_file` 节点交付声明组合在同一入口 | 已提取可复用语义原语；generated-file 声明留在托管协议，不向外部开放 |
| `packages/contracts/src/plan-runtime/node-result.ts` | Manifest 的交付物/证据带节点来源，PlanOutputState 带 AI finalization | 内容与来源分层；不能把 `sourceNodeRef` 填空字符串作为外部来源 |
| `packages/engine/src/modules/plan-execution/results/result-manifest.ts` | 按当前 NodeResult 聚合，按 key 合并贡献并更新 sourceRevision | 保持现有节点聚合行为；外部修订走结果版本 CAS，不复用跨节点 last-write 合并 |
| `prisma/schema.prisma` 的 `TaskPlanRun` | 结果容器在 planRun JSON | 为工作级成果建立独立身份，旧 JSON 保留为执行记录及兼容输入 |
| `prisma/schema.prisma` 的 `Artifact` | `runId` 必填；既有 AF 引用由 Artifact ID 派生 | 保留 Artifact ID/AF；引入有约束的工作成果归属，不直接随意置空 runId |
| `packages/engine/src/modules/plan-execution/use-cases/register-generated-plan-output-artifacts.ts` | 文件必须在真实 Run 目录内，已有附件也按 Run 校验 | 旧通道保持；外部用受控上传存储，不假造 generated URI 或读取任意本地路径 |
| `packages/engine/src/modules/tasks/accept-task-result.ts` | 要求 Completed Run；计划成果要求当前 AI finalization Ready；可能补齐真实计划级 Run | 新成果审阅不能调用此路径来创造 Run；旧托管验收保留到兼容适配完成 |
| `packages/engine/src/modules/management/result-state.ts` | 结果是否可接受取决于当前 AI finalization | 新基础成果可用性确定性派生；AI 呈现增强不决定内容是否存在 |
| `packages/engine/src/modules/tasks/accepted-result-context.ts` | 从 accepted_run_id 和已完成 Run 恢复成果上下文 | 增加版本绑定的共享读取用例；旧接受事件仍可解释，不能任意匹配最新 Run |
| `packages/engine/src/modules/goals/goal-workbench.ts`、`GoalInboxCandidate` | 输入和唯一键以 sourceRunId 为中心；正式资产版本已有可选 sourceResultId | 复用现有候选与资产概念；增加真实成果版本来源，保留旧 run 来源 |
| `packages/contracts/src/api/management.schema.ts` | legacy full 权限固定；无外部成果写入/文件上传权限 | 新权限单独显式授予，不扩大旧 full 或 `results:accept` 含义 |

当前 `acceptTaskResult` 还会触发 `task.result.accepted` 内部事件。外部成果审阅不得无意调用这一执行激活路径；事件消费行为必须另行明确，见第 5 节。

## 3. 持久化选择：一个共享成果体系

选择 **TaskResult + 不可变版本 + 版本审阅** 的工作级模型；托管执行是来源，不是成果身份。B1 已实现下表前五项；上传记录及 Artifact 新所有权分支仍为 B2 设计，不得视为已交付。

不选两个替代方案：

- 不向 `Task.description` 或任意 Event JSON 塞整份成果来绕开模型。它们无法提供完整的版本、附件、审阅和引用约束。
- 不创建 ExternalTaskResult 平行体系，也不创建“一节点计划/虚假 Run”。新旧来源使用同一语义模型和面向产品的读/审阅契约。

### 建议实体与不变量

| 实体 | 关键内容 | 不变量 |
| --- | --- | --- |
| TaskResult | workspaceId、taskId、可选 occurrenceId、非空 scopeKey、headVersionId、acceptedVersionId、editRevision | 每任务/作用域一个成果容器；`scopeKey` 对任务级或具体实例确定生成，避免 SQLite nullable unique 漏洞 |
| TaskResultVersion | resultId、单调版本号、parentVersionId、语义内容、内容哈希、服务器接收/发布时间、来源元数据 | `(resultId, version)` 唯一；发布后不可变；parent 必须是该结果的期望 head |
| TaskResultReview | resultVersionId、决定、反馈、认证主体、服务器时间、请求回执关联 | 审阅绑定确切版本；新版本不会继承旧版本接受；重复请求不重复写决定 |
| ResultVersionArtifact | resultVersionId、artifactId、语义 key、用途、是否必需 | 内容声明与关联表必须一致；同作用域、获授权；可跨版本复用同一附件 |
| ResultCommand | workspaceId、认证 actorKey、operation、requestId、payloadHash、结果/版本关联、有界回执 | `(actorKey, operation, requestId)` 唯一；与成果写入同事务；Web/MCP 共用，不保存原始文件字节或凭据 |
| ArtifactUpload / 上传块记录 | 认证主体、成果归属、大小/哈希、有效期、状态、已接收 offset/块哈希 | 重启可恢复；文件分块与 DB 回执可核对；finish 前不是可引用成果附件 |
| Artifact（演进） | 保留现有字段及 ID；新增 ownerKind 与可选 resultId，runId 允许在明确新所有权下为空 | `run` 所有权必须有真实 runId；`result` 所有权必须有真实 resultId；二者互斥，且任务/工作区/实例匹配 |

不为来源记录单独创建 Agent 服务注册表、租约或模拟执行会话。来源元数据包含服务器派生的 `human | external | managed` 类别、认证主体标识，以及可选来源标签/源工作标识/来源声明时间。外部提交者不能填写认证 actor 或内部 Run 归属。

工作成果容器可以在首次上传/提交时原子建立；它不是执行开始事实。初期一份任务成果采用线性版本和 CAS，多个贡献者并发时冲突并读取新 head，不自动合并文稿。未来分支模型不是首期前置。

### 内容与来源分离

语义内容继续复用 outcome、readiness、findings、decisions、caveats、nextActions、evidence、deliverables 的概念。`content.ts` 的原语不含任务、节点、身份或权限字段。

- 外部请求只提供声明内容和已获授权的 artifact 引用；来源由服务端写入版本信封。
- 托管适配器保留节点/Run 证据，并以服务端来源映射关联到贡献或附件；不强迫外部拥有节点 ref。
- 内容中的 readiness 仅是来源对完整性的声明。能否验收还要检查持久化、必需附件、版本和审阅权限，不能仅信任 `ready`。
- AI spec 是对应版本的派生呈现，不是语义成果本体；需绑定内容哈希/版本，迟到的增强结果不能覆盖新版本。
- 输入限额在新外层请求 schema 中定义，不收紧本轮复用的旧节点 wire schema。

## 4. 核心应用用例与事务边界

建议把共享用例放在 `packages/engine/src/modules/results/`，由 engine 公共入口导出；`contracts/results` 为 schema，`domain` 为纯规则。只在实现时创建有实际行为的模块，不预建空目录层。

### 发布结果版本

1. 根据身份检查任务及作用域访问；先查同请求回执，再按当前权限/删除状态决定可返回的内容。
2. 校验内容限额、key 唯一性、artifact 声明和引用；不接受未知字段、内部身份字段、任意路径/URL。
3. 进入数据库事务：再次核验成果 head/editRevision、所有权、作用域和附件 readiness。
4. 写不可变版本、附件关系、head 更新、审计事实和幂等回执。CAS 不匹配整个事务回滚。
5. 返回 resultId、versionId、editRevision、内容/附件可用性。刷新对应产品投影，不能在“成功”之后悄悄启动 Provider。

回执不是调用完成前先写一个成功标记。重试同参数返回原结果；相同作用域/请求 ID 不同 payload 返回冲突。不能只用内容哈希去重不同人的贡献。

### 读取与审阅

- 显式支持 latest、accepted 或确切 versionId；响应始终附所读版本，不能以最新结果替换历史 accepted。
- 内容/附件列表有界，返回截断和分页信息；人工 UI 可按版本分段读取完整合法内容。
- 审阅输入绑定 versionId 和期望审阅/成果 revision，决定为接受、要求修改或拒绝；默认只审阅当前 head，历史审阅留作事实，不静默改当前 accepted 指针。
- 接受更新 acceptedVersionId 并记录真实 actor；不会顺便关闭 Task、改变内部执行状态或确认 Goal 成功。
- 发布新版本保留旧 accepted 指针；UI 显示“新版待审，已接受版本为 Vn”，而非撤销旧事实或自动验收新版。
- 修改请求不直接编辑原版本内容；提交者读取反馈后发布新版本。发布权限不含审阅权限。

初期新成果写入拒绝已删除、Cancelled 或 Done 的任务；Completed 可补交成果但不更改任务状态。更改关闭任务需走独立现有生命周期操作。封闭 Goal 不被新结果自动重新激活，资产入库规则仍单独检查 Goal 状态。

## 5. 状态、副作用与 Goal 接续

首期不重定义 TaskStatus：外部报告/成果发布均不写 `Running` 或 `Completed`。记录式任务可以沿用现有显式 manual/todo 创建，不自动转换已有 AI 任务。成果来源不等于 Task 的永久执行类型。

产品投影分别展示任务生命周期、来源上报、最后接收时间、成果可用性、审阅和可操作权限。无报告为未知，不自动标失败；不能因为外部完成报告出现而解除内部阻塞节点。

外部成果产生独立的 `result.version_published` / `result.version_reviewed` 审计事实（建议名称），**默认不进入托管执行触发器**。既有托管任务的 `task.result.accepted` 消费和自动化行为维持。将新来源接入任何触发器必须另行设计、显式启用和防循环验证，不能以复用旧接受函数为由隐式启动工作。

Goal 衔接在 C 阶段完成：

- 候选来源增加不可变 resultVersionId，保留历史 sourceRunId；唯一键演进为真实来源标识，不把版本 ID 填入 runId 字段。
- 已接受结果进入既有 Inbox，仍需用户确认才能创建/修订 GoalAssetVersion；不绕过封闭 Goal 和资产所有权规则。
- 共享接续读取返回获授权的目标简报、指定成果版本、审阅和受控附件；Provider 会话是托管路径可选的增强，不是基础接续条件。
- B 阶段不假称外部成果已支持 Goal 自动入库；应在界面/能力中明确标示。B 的独立任务提交、查看、反馈和验收必须完整。

## 6. 拟议 MCP/HTTP 接口与权限

下列是**B2 待注册的接口设计名，不加入 B1 工具注册表**。本地实施已获批准；正式 Web 和 MCP 接入必须复用 B1 应用用例，并实现当前鉴权与文件校验适配器。

| 接口职责（建议 MCP 名） | 请求要点 | 权限边界 |
| --- | --- | --- |
| 读取成果 `chrona_result_read` | taskId、作用域/确切版本、视图与分页 | 新 `results:read`；提供语义正文，不隐含文件字节读取 |
| 提交版本 `chrona_result_submit` | requestId、taskId、期望成果 revision、内容、已有附件 refs | 新 `results:write`；无 actor/runId/status/accept 字段 |
| 审阅 `chrona_result_review` | requestId、确切 versionId、期望 revision、决定与反馈 | 新 `results:review`，独立于提交权及旧 `results:accept` |
| 受控文件上传 `chrona_result_file` | begin/write/finish/status/cancel 的闭合 action union | 新 `artifacts:write`，只作用于该任务/成果容器及本客户端上传 |
| 读取附件 | artifactRef、任务/版本、分页或字节范围 | 新 `artifacts:read`；服务端按实际关联校验，不由 allowDownload 文案授权 |

精确字段名和 schema 在 B 实现时以此方案补齐；每个接口都需要 object-root、有界响应和明确的错误枚举。旧 full/read/assistant presets 完全保持，新预设显式列举新 scopes；已经签发的凭据不会获得新能力。普通录入端默认无 review 权限。

复用现有 ManagementCommand 的认证客户/工具/requestId 去重原则，但以共享 ResultCommand 承担新用例的事务回执，Web 不伪造 ManagementClient。MCP 若保留外围管理回执，它只能引用共享命令结果，不能形成第二个成果写入者。上传块回执不保存 base64 正文，只保存偏移、长度和哈希；文件落盘与回执之间的中断必须可重放、可校验。

### 首期限额建议

新成果请求 JSON（UTF-8）最大 96 KiB、单项正文最多 8,000 字符、每类语义项最多 100、每版附件最多 20。总字节上限优先；严格检查重复 key、引用缺失和越权。超限明确拒绝，不静默截断待持久化内容。服务端错误不得回显私有文件正文或凭据。

读取沿用 128 KiB 响应预算，返回明确的分页/截断标志，ID、revision、状态和回执不得截断。

### 文件传输选择与成本

首期选择可由纯 MCP 客户端使用的有界分块上传，不要求额外常驻 Agent 或共享文件系统：

- 单块最多 32 KiB 解码后字节，单文件最多 8 MiB，单版本关联文件总量最多 32 MiB；base64 编码后的请求也必须符合整体预算。
- begin 绑定认证主体、任务/成果容器、目标大小和校验和，返回 opaque uploadId，不返回磁盘路径或带密钥的 URL。
- write 有固定 offset/块摘要；同 offset 同字节幂等，不同内容冲突，禁止越界、重叠覆盖和乱序拼接。
- finish 验证完整长度、SHA-256、文件类型和配额，原子发布 Artifact；重复 finish 返回同一引用。上传完成不等于成果已发布。
- status 可恢复位置；cancel/超时回收仅作用于未发布临时文件。回收有租期/上限并排除正在提交或已经被引用的文件，不能顺带删除已有 Artifact。
- 一次上传成功而结果 CAS 冲突时保留可重用 Artifact 和到期回收信息，不能重传制造重复文件；上传去重与成果请求去重分别记录。
- MIME/文件名是用户输入；初期未知或可执行内容仅下载，不内联执行。HTML/SVG、PDF 等预览遵守独立的安全策略，不能因为来源为 Agent 就信任。

8 MiB 文件需要最多 256 个块，MCP 方案有明确往返成本。若实测不可接受，再批准同权限的 HTTP streaming 优化；不能默默用任意路径读取或临时公开下载服务绕过。限额是本方案建议，不改变当前托管文件限额。

## 7. 兼容与迁移策略

### 发布线前置事实

**已核实并完成本地修复，2026-09-17：**

- `gh release view v0.3.1 --repo saya-ashen/Chrona --json tagName,isDraft,isPrerelease,publishedAt,url` 返回正式发布：`isDraft=false`、`isPrerelease=false`，发布于 `2026-09-02T10:46:59Z`。[发布页](https://github.com/saya-ashen/Chrona/releases/tag/v0.3.1)。
- 本地 `v0.3.1` 标签对应提交 `1cde6e17`。修复前，标签及当时 HEAD 的 metadata 都仍声明 lastReleasedVersion=`0.2.0`，mutableReleaseLineMigration=`20260822000000_repair_release_line`。
- 该目录 `migration.sql` 在发布标签中的 SHA-256 为 `641aa4b5907177ca6857c659a3ddb8fa8b7ed3d14c975f026ba250296e36675e`；本轮开始时当前 HEAD 已为 `7ae6d8acce6c79fa383ade0b1f766ab276920c9f752d886d2a6b4be8136bd55c`。这个差异在本轮 schema 修改之前已经存在。

不能把旧 metadata 的“mutable”标签当作继续修改已发布 SQL 的授权。修复结果：

1. 下载并核验 `v0.3.1` 发行包，SHA-256 与 GitHub digest 和 `SHA256SUMS` 一致；包内 schema/SQL 与发布标签逐字节一致。
2. 恢复已发布 SQL（含旧 normalizer）字节；发布后的管理 MCP、手动任务与 Goal revision 变更转入唯一未发布目录 `20260917000000_add_work_management`。基线修复当时 `prisma/schema.prisma` 未改，最终 schema 指纹仍为 `41bb15e4…`；后续 B1 在该基线上扩展模型，见第 10 节。
3. metadata 将 `0.3.1` 设为已发布基线；从核验过的包内 SQL 构造隔离 fixture，并记录明确来源。发布 checksum `641aa…` 走普通新迁移，不再视为 mutable amendment。
4. 旧 `525…`、`b46…` 和已应用 `54c…`、`5d2…`、`7ae…` 的开发历史均有完整历史 + 源指纹约束的 normalizer。未知 drift 拒绝；升级前备份、失败回滚、重复启动不再迁移。
5. 空库、`v0.2.0`、`v0.3.1`、已知开发历史，以及成果/附件/接受记录/Goal 资产保持测试通过；Linux 打包及隔离升级、备份、恢复 smoke 通过。未打开或升级用户数据库，未部署。

后续 schema 修改写入上述新目录，并同步所有有效 normalizer 的目标与 metadata 指纹；不能只追加 SQL。详见[发布线与升级兼容规范](../en/migrations.md)。B1 的发布线前置阻塞已解除。

只在当前未发布 mutable release-line 累积变更，已发布迁移永不修改；非一次性开发库的已应用 checksum 必须明确识别，不能把未知漂移标成可升级。不能修改 `0001_initial` 来假装所有数据库都是新安装。

### Expand → 兼容读取 → 收敛

1. **扩展存储。** 引入共享成果/版本/审阅/附件关系；Artifact 新归属分支加入 XOR 和作用域约束。保留现有 Run 外键与所有旧引用，不执行破坏性回填。
2. **兼容读取。** 新结果走共享用例；历史 planOutput 和接受事件通过只读适配器归一化到同一读模型。兼容标识明确区分 legacy Run 与正式 versionId，不创造虚构 Run。
3. **托管收敛。** 在 C 阶段让真实托管结果由同一个成果写用例创建版本，并保留真实 Run/plan/node 元数据。旧 planOutput 若仍需写入，应是该用例输出的兼容投影，不允许第二个作者独立改变成果。
4. **审慎回填。** 幂等地按 task/instance/真实来源与 manifest revision 映射历史；已存在版本不得覆盖。保持 Artifact ID/AF 与既有 accepted_run_id 解释能力。旧记录缺少可证明的历史内容时显示历史限制，不拿当前最新内容冒充曾验收的版本。
5. **历史验收保留。** 映射后接受仍绑定对应不可变内容；新外部记录没有 Run 时不能写旧 accepted_run_id。旧 accepted 事件、GoalAsset 版本和下载链接回归测试通过后，才考虑减少兼容代码。

### 回滚

采用 additive 变更和新写入口独立开关。停止接收新外部提交后，保留新结果只读，不删除记录/文件，不反向塞回 Run；关闭入口不撤销外部已发生的工作。

新增 Artifact 分支后，旧二进制不一定能正确读取空 runId。**不能承诺直接降级二进制安全**：必须使用兼容版本，或在明确停写、备份和数据损失评估后恢复旧快照。降级演练和恢复边界是发布门槛。

## 8. 实施切片、测试与审批门槛

| 切片 | 输出 | 必须验证 |
| --- | --- | --- |
| A0：本轮已做 | 共享内容 schema；原 API 组合复用；来源类型分层 | 旧 wire schema 不变、边界负例、typecheck |
| B1：存储/共享用例 | 结果身份、版本 CAS、审阅、持久幂等、来源隔离 | 无 Plan/Run 写入；并发/重试；鉴权失败无写入；内容/附件/回执事务一致 |
| B2：附件与入口 | 新显式 scopes、MCP schema、分块上传/受控读取 | 旧凭据能力不扩大；同请求不同内容冲突；越权/路径/配额/未完成上传/恢复 |
| B3：确定性成果 UI | 独立任务的文本/附件/反馈/验收闭环 | 无 Provider、执行服务禁用；刷新/重启后仍可用；错误可恢复；三种屏幕无溢出 |
| C：托管兼容/Goal 接续 | 历史读取、统一来源、版本反馈、Goal Inbox 复用 | 已接受结果/AF/旧生命周期不回归；迟到消息不污染其他实例；无隐式触发执行 |

B1/B2/B3 合起来才是产品架构所说的阶段 B；只实现文字记账不算完整交付。

新增关键负例：

- 完成报告不能赋予验收或生命周期控制权；上报 actor/runId 被拒绝。
- 改变结果权限预设后，旧 token 仍不能提交或读取新增内容面。
- 同任务不同实例、同任务不同结果版本之间，附件/反馈不能串用。
- 首次提交失败/重试不留下孤立 head 或重复已接受记录。
- Task 被删除/取消或权限被撤销后，迟到写入不能靠旧回执重新生效或泄漏内容。
- 验收旧版本与新版本发布并发时，CAS 给出明确冲突，不接受错误版本。
- 外部成果验收不调用 Provider、不触发旧自动执行、也不完成 Goal。
- 旧 schema fixture 升级后，原结果/附件/接受与 GoalAsset 的事实保持。

**已批准的 B 本地范围：** 新持久化模型及兼容迁移、Artifact 所有权分支、新成果/附件权限与 API、独立结果审阅和相应 UI。此批准不包含线上迁移、凭据重新签发、部署、启动实际 Agent、改动 Provider 协议或全量界面重构。第 7 节发布线兼容前置问题已修复，B1 核心实现见第 10 节。下一切片是 B2；不要求用户再次批准同一 B 本地范围。

## 9. 本轮验证记录

- `bun test packages/contracts/src/results/content.bun.test.ts packages/contracts/src/api/mcp-task-tools.schema.bun.test.ts packages/contracts/src/api/execution.schema.bun.test.ts`：52 passed，0 failed。
- `bun run typecheck`：通过（应用与 E2E TypeScript）。
- 本切片四个 TypeScript 文件的 ESLint：通过。
- `bun run check:boundaries`：0 errors、10 warnings；告警涉及未修改的 engine 测试导入，无本切片路径。
- 原有 Pi-provider 未提交差异哈希保持 `a6fc01fa068ef02a71d227517a7e3ecd55f97b68`，未纳入本切片。

以上为阶段 A 的契约基础与设计验证，不是外部成果 E2E 或实际部署验收。

### 发布基线修复验证（2026-09-17）

- DB + 阶段 A 契约回归：128 passed、1 skipped、0 failed；含发布/已知开发历史、记录保持、备份、重复启动、事务回滚与漂移拒绝。
- `bun run typecheck`、`bun run check:release-consistency`、`bun run check:boundaries`：通过。边界检查仍有 10 项未修改 engine 测试的既有告警。
- 本切片修改/新增 TypeScript 文件 ESLint（`--max-warnings 0`）：通过。
- `bun run chrona build linux-x64`、`bun run build:smoke`：通过，含打包后的 v0.3.1 升级、备份、恢复。
- 全仓 `bun run lint`：仍被相对 `origin/main` 的既有 ratchet 债务阻塞：`features/schedule/ui/forms/task-config-save.ts` 1 项、`packages/engine/src/modules/tasks/manual-task-lifecycle.ts` 2 项。本切片未修改这两个文件；不能声明全仓 lint 全绿。
- `git diff --check` 在三份恢复的发布 SQL 上提示原有尾部空行。保留发行字节，不为消除格式提示改变发布 checksum；排除该不可变目录后的检查通过。
- `prisma/schema.prisma` 和原有 Pi-provider 差异保持不变；未提交、推送、部署、签发凭据或升级用户数据库。

本地日志：`/tmp/chrona-release-baseline-1NkIa7/final-*.log`。以上是发布基线修复时的记录；B1 后续实现见下节。长期兼容规则、来源与升级矩阵见[发布迁移规范](../en/migrations.md)。

## 10. B1：已实现的存储与共享用例

### 已交付到本地源码

- Prisma：`TaskResult`、`TaskResultVersion`、`TaskResultReview`、`ResultCommand`、`ResultVersionArtifact`。task/occurrence 使用非空 scopeKey；head、accepted、parent 和 review/command 的复合外键约束同一结果容器。
- SQLite：作用域校验、身份不可变、head 单步前进、revision 单调递增、版本/审阅/回执不可更新、版本附件关系封存。删除必须从所属成果容器开始；既有显式任务删除用例先删除容器，再删除 Run-owned Artifact，不留下孤立关系。
- `@chrona/contracts/results`：有界严格请求和内容 schema，拒绝 actor、workspace、run、status 等权威字段，校验重复 key 和附件数量。原托管协议未收紧或改名。
- `createTaskResultsService()`（`@chrona/engine` 导出）：`publish`、`read`、`review`。工厂要求可信 `authorize` 适配器，每次操作与重放均在事务内刷新身份/权限；请求不能提供 principal。尚未绑定到现有 Web/MCP 路由。
- 发布：验证 → CAS → 不可变版本与附件关系 → head → 回执及独立审计事实，全事务提交。同 actor/工作区/operation/requestId 的不同规范化参数冲突；相同参数返回原回执。源码中无 Provider、Plan 或 Run 创建调用。
- 审阅：只能操作明确的当前 head；接受不改变 Task、执行状态或 Goal。审阅保存唯一的成果 revision 并按其排序，不用时间戳或随机 ID 猜先后。新版本保留旧 accepted 指针。要求修改/拒绝新增历史事实，不擦除先前接受事实，也不改旧内容。
- 读取：latest、accepted、确切 version；另有版本与审阅列表。按实际编码字节缩减页大小并返回 nextOffset，不裁剪已保存正文或跳过未返回条目。`canAcceptContent` 只表示内容前置条件，不是权限或生命周期授权。

### B1 附件边界

B1 仅关联既有、获授权的同任务/同 occurrence Artifact，并校验其真实 Run 归属；未引入任意路径读取或假 Run。现有 `AF...` 算法提取为中立 helper，原调用结果保持不变。

- 文件必须经可信的本地 `artifactAvailable` 适配器确认；未提供适配器时默认不可用，不把数据库有一行当作文件验证。
- 版本关系保存 Artifact 身份、URI、类型和 metadata 的指纹。接受/读取重新比对；原记录发生变化时标记不可用，不自动转用新内容。实际字节校验仍必须由文件适配器执行。
- AF 解析限定作用域、使用 ID-only 有界查询，并拒绝哈希歧义或查询上限。不可把 `presentation.allowDownload` 当作权限。
- **尚未实现**独立上传、Artifact 的 result 所有权、生产文件可用性适配器、附件下载及清理。它们属于 B2；B1 不是完整的附件闭环。

### 迁移与后续边界

新模型累积在 `20260917000000_add_work_management`，已发布 SQL 不变。为上一版未发布 checksum `6a646400…` 登记 amendment 和源指纹 `41bb15e4…`；五条旧开发 normalizer 同步到 B1 目标。`fixtures/pre-work-results.sqlite` 为修复后的开发基线回归样本，不是用户数据库。

B2 接入不得直接信任传入 principal：必须在可信路由组合中从当前认证凭据/本地用户会话派生，并复查撤销、权限和任务访问。新 scopes 仍未加入旧管理权限预设，旧凭据没有获得新能力。托管写入收敛、历史读取桥接与 Goal Inbox 接续仍留在 C。

### B1 验证记录

- 合并核心、DB、契约、任务删除及旧成果/管理读取回归：209 passed、1 skipped、0 failed（24 个文件）。包含并发发布/审阅、服务重建后重放、原子回滚、越权、作用域隔离、附件变更、封存关系、审阅顺序与已接受版本保留。
- `bun run typecheck`、`bun run check:release-consistency`、`bun run check:boundaries`、本切片 ESLint `--max-warnings 0`：通过。
- `bun run chrona build linux-x64`、`bun run build:smoke`：通过，含隔离发布库升级、备份及恢复。
- 全仓 `bun run lint` 仍被两个未修改文件的既有 ratchet 告警阻塞（见第 9 节），本切片没有新增 lint 告警。
- 未接入新工具、未签发凭据、未运行真实 Agent、未执行线上迁移或部署。无外部成果 UI/E2E 交付声明。

日志：`/tmp/chrona-work-results-b1/`。下一步 B2，随后 B3 完成人可见的成果闭环。
