# v2-13 规格：模块管理是 `modules` 的工具，构建是会话

状态：已实现（2026-10-25）；与草案的差异见第 8 节。依赖 [v2-8](platform-v2-8-calls-only.md)、[v2-11](platform-v2-11-provider-module.md)。

## 1. 背景

- 提交、取出、回滚模块是 Provider 专用的内核工具（`chrona_propose`、`chrona_module_checkout`、`chrona_module_rollback`、`chrona_modules`），与 v2-8“一切都是路由调用”不一致；系统模块 `modules` 只有 `list`、`tools`。
- `chrona_propose({ request })` 走单独的构建运行：自己的队列、尝试与结算记录；没有会话；失败由内核另开运行重试，新运行只看到截断的报告；构建目录与 Pi 记录在结算后删除；结果不回到发起它的对话。网页上看不到构建过程。

## 2. 改动

### 2.1 `modules` 的工具

| 工具 | 调用方 | 作用 |
| --- | --- | --- |
| `list` | Provider、用户（MCP/网页）、`uses` 列出它的模块 | 不变 |
| `tools` | 同上 | 不变 |
| `check({ module, hash?, wait? })` | Provider、用户 | 某个版本的状态与报告（测试输出、错误、数据连续性、键检查）；最多等 `wait` 秒，等它离开 `building`/`testing`（上限见 2.5） |
| `reference({ target? })` | Provider（含构建会话） | 只读开发参考：接口目录，或指定 `<module>.<tool>` 的参数、已声明的输出/示例及准入规则；不执行目标 |
| `checkout({ module, hash?, dir, source? })` | 仅 Provider | 把源码复制到调用方工作目录下的空目录；默认 `stored` 为活动/指定存储版本，`builtin` 为当前发布附带的参考源码（不可同时传 hash） |
| `propose({ dir, intent })` | 仅 Provider | 从调用方运行工作目录提交模块（原 `chrona_propose({ dir })`），立即返回 `{ moduleId, hash, status }`；之后用 `check` 取结果 |
| `rollback({ module, hash })` | Provider、用户 | 原 `chrona_module_rollback`，语义不变 |
| `build({ name, goal, examples, files, intent })` | 仅对话中的 Provider | 开一个构建会话（2.3），原 `chrona_propose({ request })` |

- “仅 Provider”的工具需要调用方的运行工作目录：内核按调用方 `{ kind: "provider", runId }` 找到 `run.cwd`，路径必须在其中。用户（MCP）没有工作目录，不能提交或取出。
- 普通模块永远不能提交、取出、回滚或开构建（`visibility` 不含 `modules`），否则模块可以给自己升级。
- 启用仍只有一条路：用户批准与内容哈希绑定的 `activate_module` 审批（或已有的“自动启用”授权）。这些工具都不能启用版本。

### 2.2 Provider 能调用系统模块的工具

Provider 的工具目录现在只含数据库里的模块。改为同时列出 `visibility` 含 `provider` 的系统模块工具，同样命名 `m_<module>_<tool>`、同样经 `callModuleTool` 作为路由调用执行、记录真实调用方。`chrona_propose`、`chrona_module_checkout`、`chrona_module_rollback`、`chrona_modules` 删除，不保留别名（只有旧的 Pi 记录会提到它们）。

### 2.3 构建会话

- `modules.build` 创建会话：来源 `build`（`SESSION_SOURCES` 新增），`originSessionId` 为调用方运行所在会话，标题“构建模块 <name>”；排入一个后台运行，提示为现有构建提示（规则、清单格式、模型档位、`ui` 偏好）加请求内容。
- 工作目录就是会话目录（`<dataDir>/sessions/<id>`），会话结束前不删除：`request.json`、`files/`、`current/`、`node_modules/chrona/`、`chrona/run-tests.sh` 在开始时写入。
- 工具集固定：Provider 自带的文件、shell、浏览器工具，`chrona_reply`，以及 `m_modules_propose`、`m_modules_check`、`m_modules_checkout`、`m_modules_reference`。没有生产业务工具、不能读取用户数据。开发参考只返回接口元数据和发布源码，不执行目标；无需开放 discovery 或把其他应用的可执行工具给构建者（详见第 11 节）。
- 在同一个运行里迭代：提交 → `check` → 按报告修改 → 再提交。每个运行默认最多提交 5 次；构建默认独立限时 60 分钟，普通后台运行仍为 20 分钟。构建的时限和提交上限可在设置中修改，在运行开始时快照，不追溯改变当前运行。构建失败或超时会通知用户、保留工作，等待人工继续，不自动创建付费重试。
- 结束时 Provider 用 `chrona_reply` 写结果（成功的版本 hash 或未完成的原因）。`build` 加入 `deliverResult` 的来源：回复复制进原会话并推送到它的入口（QQ/网页），与唤醒相同。审批卡照旧单独发出。
- 预算：每个工作区同时最多一个运行中的构建，另外最多10个等待；新请求持久化进入 lane `build` 的 FIFO 队列，不因已有构建而拒绝。每天默认最多新建20个构建会话，可在网页设置中调整；入队即占新建额度，失败/取消不退回；手动续作不另占新建额度，实际领取时仍受每会话每日24次、全局每日200次运行的预算约束。
- 返回 `{ status: "build_queued" | "build_running", sessionId, runId, queuePosition, aheadCount, waitUntil, duplicate }`；`queuePosition` 对等待者从1开始，运行中为0；`aheadCount` 包含前面正在运行的任务。队列满时以 `conflict` 拒绝，不创建会话、不占每日新建额度。
- 构建会话保留以便「修改需求并继续」；闲置 7 天且没有排队/运行中的构建时自动结束，之后需要重新提出构建。
- 新候选进入审批时，同一模块更早的待审候选（不含内置发布版本）的审批卡过期，版本标为 `rejected`，错误为 `Superseded by newer candidate <hash>`；它不计入连续构建失败，同一 hash 可重新提交。
- 同一来源会话的完全相同请求在其构建仍排队/运行时返回同一会话和运行（`duplicate: true`），跨服务重建仍有效；已停止/结束后可再次请求。不同请求或不同来源会话不合并。
- 排队不调用模型，不设置运行开始时间或单轮 deadline；实际领取时快照最新时限和提交预算。运行额度不足时队首等到下个本地日界，不让后面的构建插队；用户可以取消该任务。普通对话/唤醒队列不受这一 FIFO 等待策略影响。
- `current/` 是入队时的基线快照；构建提示明确要求已有模块在开始修改前用无 hash 的 `modules.checkout` 比对最新启用版本，与保留的工作合并，不盲目覆盖。
- 队列只保证串行，不表达依赖成功或审批通过。一个任务失败后可运行下一个已经授权入队的任务，但不重试失败任务、不绕过候选版本审批。

### 2.4 在网页上看构建过程

- 构建会话出现在会话列表里（来源“构建”），消息照常显示。
- 新增 `chat.transcript({ session })`：读取该会话的 Pi 记录（`.chrona/sessions/`），返回整理后的时间线——Provider 的说明文字、工具调用（名称与参数摘要）、截断的结果（每条 ≤ 2000 字）、提交与检查结果。所有会话都可读（页面只给用户本人用）。
- 保护的是两件事，而不是对话内容本身：运行令牌、模型 API key 等已知密钥替换为 `[redacted]`；`callers` 只允许入口模块 web 与 mcp，`uses: ["*"]` 的普通模块也不能读。
- 会话消息不变：过程不写进消息，以免挤占每次运行带入的最近 20 条上下文。
- web 模块在会话页显示“过程”区（构建会话默认展开，对话会话默认折叠），进行中的构建在今天页显示“构建模块 <name>”并链接到该页。

### 2.5 调用方决定工具调用的等待时长

- 现在 Pi 扩展调用每个 Chrona 工具固定等 60 秒，服务端 HTTP 空闲超时 120 秒。改为：每个工具调用可带可选的 `timeoutSeconds`（默认 60），由调用方按任务预期填写。
- 扩展用它作为这次调用的 HTTP 超时；服务端用 Bun 的单请求超时把这次请求放宽到同样时长；需要等待的工具（如 `modules.check` 的 `wait`）以它为上限。
- 上限：不超过本次运行剩余时间，且不超过 600 秒。超时只结束等待，不取消已开始的工作（检查照常进行，之后再 `check`）。
- 以后可加回调：长任务完成时由内核把结果推入运行（Pi RPC 已支持向运行中注入消息），调用方不必阻塞等待。本版不做。

## 3. 删除

构建运行（lane `build`）及其排队、准备、提交、结算代码（`requestBuild`、`prepareBuildRun`、`proposeFromBuild`、`settleBuildAttempt`、`module_build_request/attempt/submission/rejection/settled` 记录）、`RUN_LIMITS.buildTimeoutMs`、`maxBuildAttempts`、`maxBuildSubmissionsPerRun`。

## 4. 不变

提交快照与内容哈希、`platform/staging` 与 `platform/store`（Provider 不可见）、全部构建检查（入口模块限制、模型档位、依赖安装、沙箱测试、数据连续性、试启动、键检查）、审批卡内容、自动启用与内置版本规则、回滚。

## 5. 升级

启动时仍在排队或运行的旧构建运行标记为取消，并通知用户“构建已取消，请重新发起”。已完成的版本、审批不受影响。

## 6. 验证

- 表格测试：`modules.*` 各工具对 Provider、用户、普通模块、构建会话的准入；路径越界拒绝。
- 构建会话：开会话 → 提交失败 → `check` 拿到报告 → 再提交成功 → 结果回到原 QQ/网页会话、审批卡发出；工具集里没有其他 Chrona 或模块工具。
- `chat.transcript`：web/mcp 可读、其他模块（含 `uses: ["*"]`）被拒；截断、密钥替换。
- 网页：构建会话页在 1440/1024/390 宽度下显示过程。

## 7. 以后

- 回调：长任务完成时内核把结果推入运行（见 2.5），代替阻塞等待。

## 8. 实现与草案的差异

- **构建保留独立的运行队列**（lane `build`），只是现在必须属于一个构建会话。草案打算删掉它、让构建走后台队列；但后台队列同时只跑一个运行，构建最长 20 分钟会挡住定时唤醒和模块唤醒。删掉的是“无会话、单独准备目录、内核结算重试”那一套。最初时限沿用后台运行（20 分钟），后因前端迁移实际超时，将构建独立放宽到 60 分钟，并停止自动重试。
- `modules.list` 也对 Provider 开放（原 `chrona_modules`），用户（MCP/网页）可用 `check`、`rollback`；`propose`、`checkout`、`build` 只给 Provider。模块工具的结果与其他应用工具一样包在 `{ result }` 里。
- Provider 可见的系统工具排在工具目录最前，始终直接暴露（不用工具搜索）；系统工具可以用完整的 zod 结构定义参数（`SystemTool.input`），不受模块工具“只能是标量”的限制。
- 构建会话不接收普通消息：往构建会话发消息、或用 `build:` 开头的键新建会话都会被拒绝。用户纠偏走下面的构建控制工具，不走 `chat.send/ask`。
- 每次提交都记录提交者（`module_submission` 审计：运行、会话、hash），供以后的回调使用。
- 由 Provider 提交、被拒的版本仍会触发原来的修复唤醒；构建会话提交的版本不触发（构建会话自己看 `check` 的报告）。
- 升级：启动时把没有会话、仍在排队或运行的旧构建标记为取消，并发一条“模块构建已取消”的汇总通知。

## 9. 构建控制工具

- `modules.stop-build({ session })`：停止指定构建会话的排队/运行中工作，保留会话、文件和过程；重复停止没有运行的构建成功返回。Provider 名称为 `m_modules_stop_build`。
- `modules.revise-build({ session, requirements, files? })`：修改需求（非空，最多 4000 字）。先停止旧运行并撤销旧令牌，再在同一会话和工作目录排入新的构建运行；新要求记录在会话消息及 `request.json.revisedRequirements`，提示明确新要求覆盖冲突的旧要求。Provider 可额外传最多 10 个参考文件，owner 不能传宿主文件路径；文件在停止旧运行前解析，缺失则拒绝且不停止旧运行。补充资料写入独立的 `files/revision-<uuid>/`，追加到 `request.json.files` 及新提示，不覆盖草稿或旧资料。Provider 名称为 `m_modules_revise_build`。
- 两者只面向 Provider 与 owner，模块调用方只允许 web/mcp；普通模块与构建 Provider 均不可调用。会话必须属于当前工作区、来源 `build` 且仍为 active。
- 新建/停止/修改按工作区串行；另有构建进行时可以恢复旧构建，排到队尾。修改不新建会话；替换自身排队任务在满队列时仍允许；若只有自身正在运行而等待队列已满，则先拒绝修改，不能先停止原任务再报队列满。沿用运行时限、每日运行及每会话运行预算、每运行提交次数限制。
- 构建页显示「停止构建」「修改需求并继续」。失败显示错误并保留需求输入；结果仍发回原会话。`chat.transcript` 为构建会话增加明确标注为「Chrona 构建状态」的内核状态行，复用现有 React/内置网页的「过程」区显示排队位置、前方数量、额度等待及结束/停止状态；刷新页面更新，不伪造 Provider 的 active/progress，不将状态写成模型消息，也不替换已定制网页。
- 构建自测仍在断网、源码只读的沙箱执行；作者测试的虚拟地址空间限额为 2 GiB，适应 React/TypeScript 编译，运行模块和数据迁移仍使用原来的 512 MiB 默认限额。单项测试 60 秒与输出限制不变；测试限额由内核设置，不由候选模块清单决定。
- **停止不是回滚或撤回审批**：已经提交的版本仍按原检查/审批流程处理；这两个工具不撤回审批、不撤销启用。页面确认框明确说明这一点。

- 系统工具的业务拒绝保留 `conflict/invalid/forbidden/not_found`；Provider HTTP 边界对应409/400/403/404，不再吞成 `INTERNAL_ERROR`。模块 SDK 的错误契约同步包含 `conflict`；未知内部故障仍为通用500，不暴露原始异常。

## 10. 网页构建设置

- 「设置 → 构建设置」配置每日新建上限（0–200，默认20）、单轮时限（5–120分钟，默认60）、每轮候选提交上限（1–20，默认5）。0仅暂停新建，不会停止已有构建或禁止人工续作。
- `settings.get` 返回 `builds: { dailyLimit, timeoutMinutes, maxSubmissions }` 和 `buildUsage: { date, timezone, used, remaining }`。每日使用量按通知设置中的当前时区、构建会话的创建日期计算；失败/停止的会话仍计数，修改需求或人工续作不重复计数。
- `settings.update({ settings: JSON.stringify({ builds: { ... } }) })` 经已有入口模块权限校验，支持部分更新，保存到工作区设置；不需要重启，不改动通知、模块模型和其他设置。非法、越界、非整数或未知字段拒绝且不部分保存。
- 领取构建运行时，将时限和提交额度写进 `run_claimed` 审计快照，并明确告知 Provider；之后修改设置不改变该运行的 deadline、lease 或提交额度。升级前没有快照的已有运行保留原来的5次提交限制。
- 页面显示今日已用/剩余量、日期与时区、费用提示；保存防重复提交，失败保留输入。全局运行预算、沙箱资源限制、不自动重试、停止及启用审批均不因这组设置放宽。

## 11. 构建开发参考与资料完整性

### 问题与边界

构建者没有生产工具，但过去只有清单格式与当前模块源码：涉及新系统接口或新内置功能时，父会话必须猜出全部资料并手工附带，缺失后构建者又无从发现。这不是要求放宽生产权限，而是缺少版本明确、可查询的开发参考。

### 接口参考

- `m_modules_reference {}` 列出已注册系统工具和本工作区活动模块工具的名称、描述、来源；传 `{ target: "modules.diagnostics" }` 等准确目标，返回 `inputSchema`、`outputSchema`、`documentation`、`examples`、`admission`、通用 `routingErrors` 与 `contractHash`。它既给对话中的 Provider 用，也在构建白名单中；owner 与普通模块不可调用。
- 准入规则返回实际声明的 `visibility`、`callers`、`uses` 目标和幂等性，只是文档，不授予执行权。开发者仍须声明并审批新 uses，真实路由照常检查。
- 输入和准入从注册信息生成；系统工具可声明输出 schema、说明及合成示例。未声明的输出明确返回 `null`，示例为空，不从生产空结果推测字段。不是所有旧接口都已有输出契约；开发者增加/修改接口时应维护输出及回归，不宣称任意输出都已完整建模。
- `modules.diagnostics` 提供完整响应 schema、状态语义及 retrying/unresolved/verifying/recovered 的非空合成示例，复用持久化 incident schema。真实返回与 schema 有回归比对，示例不含生产故障或凭据。
- 参考查询不调用目标 handler、不读取设置值、故障记录、消息或应用业务数据，不启动模块/Provider，不做健康探测。模块参考只读取当前工作区的活动清单工具元数据，附带来源 hash；系统契约内容变化可由 `contractHash` 识别。参考与日志仍是数据，不是授权。

### 发布内置参考

- `m_modules_checkout { module: "web", source: "builtin", dir: "release-reference" }` 从**运行中发布包**的受信 `moduleBuiltinResources` 复制源码，适用于新内置版因保留定制而从未注册进版本库的情况。它不是从数据库里挑一个历史内置 hash。
- 默认 `source: "stored"` 保留原活动/指定 hash 的检出语义；结果明确标记 source 与实际检出 hash。默认活动 hash 先选定再复制，不允许两次读取活动版导致返回的 hash 与文件不一致。
- 内置参考按与提案相同的文件路径/字节算法生成内容 hash。它只说明参考内容，不代表该版本获批；不创建版本/审批、不改变活动模块、不自动把整包覆盖到定制版。
- 发布资源缺失明确拒绝，不回退到旧内置版。拒绝路径越界、符号链接与非空目标；允许 Nix 对受信源文件去重的硬链接，但输出是调用方目录下的独立普通文件。

### 交接与续作

- 新建构建时，在创建构建会话、占用新建额度前解析并读取所有指定参考附件；缺失明确报错，不静默省略。参考源仍限于调用方 cwd 或已存会话附件，大小限制不变。
- 每次实际领取构建运行时附加当前开发参考说明并提供 reference 工具，**包括升级前创建、随后人工续作的旧构建会话**；不依赖旧 Pi 会话记住新工具，不给生产 discovery。
- 主会话可通过 `revise-build.files` 补齐剩余资料，保留原会话/工作目录、草稿、过程及预算；不另占每日新建额度，不自动启动收费重试，不撤回或批准已有候选。
- 仍无法获得契约时应报告准确缺失目标/文件，由发起会话补齐后人工续作；不能猜字段、扩大权限或把仅运行旧测试宣称新功能完成。

### 验证

离线脚本 Provider 覆盖不带手工参考附件的“发现契约 → 分别检出活动定制版和当前发布内置版 → 合并夹具 → 标准检查 → 待审批”，并断言活动 hash 不变。另覆盖缺失资料不入队/不收费、补资料续作不丢草稿/旧令牌失效、owner 路径与生产工具拒绝、跨工作区隔离、路径/链接/Nix 去重边界和契约示例。该测试证明供给链路，不冒称真实模型完成了生产 Web 合并。
