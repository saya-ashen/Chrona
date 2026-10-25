# v2-13 规格：模块管理是 `modules` 的工具，构建是会话

状态：已实现（2026-10-25）；与草案的差异见第 8 节。依赖 [v2-8](platform-v2-8-calls-only.md)、[v2-11](platform-v2-11-provider-module.md)；取代 [P4 构建规格](platform-p4-build-spec.md) 的构建运行（lane `build`）。

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
| `checkout({ module, hash?, dir })` | 仅 Provider | 把版本源码复制到调用方运行工作目录下的空目录（原 `chrona_module_checkout`） |
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
- 工具集固定：Provider 自带的文件、shell、浏览器工具，`chrona_reply`，以及 `m_modules_propose`、`m_modules_check`、`m_modules_checkout`。没有其他 Chrona 工具、没有其他模块工具，看不到用户数据（与现在的构建运行相同）。
- 在同一个运行里迭代：提交 → `check` → 按报告修改 → 再提交。每个运行最多提交 5 次；运行时限沿用后台运行（20 分钟）。
- 结束时 Provider 用 `chrona_reply` 写结果（成功的版本 hash 或未完成的原因）。`build` 加入 `deliverResult` 的来源：回复复制进原会话并推送到它的入口（QQ/网页），与唤醒相同。审批卡照旧单独发出。
- 预算：每个工作区同时最多一个进行中的构建会话；每天最多新建 `RUN_LIMITS.maxBuildRunsPerDay`（6）个构建会话。

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

- **构建保留独立的运行队列**（lane `build`），只是现在必须属于一个构建会话。草案打算删掉它、让构建走后台队列；但后台队列同时只跑一个运行，构建最长 20 分钟会挡住定时唤醒和模块唤醒。删掉的是“无会话、单独准备目录、内核结算重试”那一套。时限沿用后台运行（20 分钟）。
- `modules.list` 也对 Provider 开放（原 `chrona_modules`），用户（MCP/网页）可用 `check`、`rollback`；`propose`、`checkout`、`build` 只给 Provider。模块工具的结果与其他应用工具一样包在 `{ result }` 里。
- Provider 可见的系统工具排在工具目录最前，始终直接暴露（不用工具搜索）；系统工具可以用完整的 zod 结构定义参数（`SystemTool.input`），不受模块工具“只能是标量”的限制。
- 构建会话不接收消息：往构建会话发消息、或用 `build:` 开头的键新建会话都会被拒绝。
- 每次提交都记录提交者（`module_submission` 审计：运行、会话、hash），供以后的回调使用。
- 由 Provider 提交、被拒的版本仍会触发原来的修复唤醒；构建会话提交的版本不触发（构建会话自己看 `check` 的报告）。
- 升级：启动时把没有会话、仍在排队或运行的旧构建标记为取消，并发一条“模块构建已取消”的汇总通知。
