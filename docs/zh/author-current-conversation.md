# 当前对话 Agent 创作与固定材料提交

状态：实现、隔离验证及本地 3112 服务部署完成。本轮未发起真实模型请求，未重试此前播放器请求。

用户已批准使用当前对话的 Agent 编写应用，并通过 Author 提交，沿用现有候选检查与审批。Author 不需要另起模型执行器；本轮不新增内核 API、执行队列或权限。现有内核仍为五个公开命名空间、32 个工具。

## 实际路径

1. 当前对话 Agent 通过已有的真实入口身份发现工具与当前批准的 Author moduleId/hash，并确定完整目标及更新时的活动基线。
2. `author.prepare` 生成 `kind:"material-preparation"`、request、admission 草案及 prompt。它是纯函数：不启动模型、不写文件、不签发授权、不提交、不安装。
3. 真实 owner 入口经 `modules.admit-candidates` 签发绑定当前 Author 提交身份、全部目标和精确基线的一次材料准入。Author 自身不具备签发权限。准备结果中的身份不是授权证据。
4. 当前 Agent 使用 `author.write/read/list` 编写和检查 Author 私有源码。更新已有应用时可通过 `author.source` 读取准入覆盖的精确基线。必要时 `author.stage` 整理材料。
5. `author.submit` 以实际 Author 模块身份转交整个固定集合。内核冻结材料、保存唯一回执并进入检查；调用参数不能冒充模块身份。
6. `author.receipt` 使用精确 receiptId 或 admissionId/requestKey 查询检查与审批。丢失回复时保留原 key，不自动换 key 重投。通过检查、批准与实际激活各有独立证据，pending 不表示完成。

当前 Run 的权限、工具目录、租约、取消、期限及预算继续生效。材料准入仅授权材料提交，不授权新的模型执行；无需把两者绑定成第二套执行授权。普通无 owner 权限的入口不能借此签发准入或调用 owner 工具。

## 本轮修改

移除 Author 返回的 `execution.supported:false` 和“缺少受限执行器”的阻断说明。`prepare` 输出及 Manifest schema 同步为材料准备结果，prompt 指明当前 Agent 继续创作、真实入口签发准入、Author 实际身份提交的分工。同步普通 Author 测试、根策略测试及当前边界说明，保留现有提交、检查、审批与数据损失守卫。

## 验证

- 根类型检查 `bun run typecheck` 通过。
- 当前改动的 lint 检查 `LINT_RATCHET_BASE=HEAD bun run lint` 通过，4 个已跟踪代码文件没有增加告警；新增集成测试单独运行 ESLint，通过。默认 lint 基线包含此前合并的其他改动，会因那些文件的已有告警失败；本轮没有修改那些文件，也不将默认全量 lint 记为通过。
- 官方逐文件测试运行器验证 Author 策略、Author 离线 SDK、native SDK 路由、源码导出与 SDK 构建：5 个文件，15 项通过、0 失败，日志 `/tmp/chrona-author-current-focused.log`。
- 新增 `author-conversation-submission.bun.test.ts`：1 项通过，172 个断言，日志 `/tmp/chrona-author-conversation-proof.log`。该测试与三个相邻回归文件合跑共 28 项通过、477 个断言；这些结果存在重叠，不相加为独立覆盖数。
- 实际创建已认领的 Agent Run，并通过 `contextRunTools` / `callContextTool`、真实 Author SDK 子进程、材料冻结、真实候选检查、组审批和同一代激活验证整个路径。一个已有应用与一个新应用同时提交；覆盖实际 issuer/submitter 身份、错误提交者、越界或变化目标集、原 key 重放、变更材料冲突、冻结后源文件变化，以及已有应用临时数据保持不变。
- 独立只读审查没有发现阻断问题。`git diff --check` 通过。

Author 离线发布材料已同步，其他应用的受版本控制发布包保持原样：

- Author Git commit：`84d06be1501c8c39f1fb8d7aba67397b74548da4`。
- `author.bundle` SHA256：`89d3a37c79162724be83d9027562b3545f1981ae6708328d206c3471f32ec4a6`。
- 从 bundle 的 `main` 克隆后核对 commit、SHA256，并将全部 10 个文件与最终源码及许可证逐字节比较，通过。

实现验收使用临时 SQLite 和离线测试材料；没有调用真实模型，没有自动提交此前播放器需求。用户随后明确授权部署，部署仅执行 Author 的受检更新。隔离测试证明工具与提交路径接通，不证明真实模型一定会正确创作；本地 3112 服务已通过下述检查使用这版 Author。


## 本地部署

用户授权后于 2026-11-09T11:53:10.023033+00:00 更新 `chrona-kernel-preview.service`（127.0.0.1:3112）。本轮只替换 Author 普通应用资源和对应离线种子条目，沿用已运行的二进制 `d69c49813123a8a102164537b994ea61f60787a2de4bf876db0d3e6ace2038a2`；其他应用版本保持原样。

停止服务后备份完整数据、环境及发布目录，使用 `admin install author --update` 进入现有检查流程，仅批准精确绑定本轮 Author commit 的激活请求，并等待实际运行及 activation verified。Author 活动版本为 `84d06be1501c8c39f1fb8d7aba67397b74548da4`。

线上检查通过：

- 实际经 MCP 发现并调用 `author.prepare`，返回 `material-preparation`，无 `execution` 字段，提示当前对话 Agent 使用 Author 创作；该调用不写入材料、不签发准入、不提交候选、不创建 Run。
- 九个现有应用正常，应用 ID、其他应用版本、私有模型设置、通知设置、内核预算、会话记录和服务环境保持不变。
- Web/MCP 鉴权、24 个 MCP 工具、5 个内核命名空间与 32 个工具、六个应用设置页、Mind 页面及 Coding 只读接口通过。Mind 自动检查和通知仍关闭。
- 3111 旧服务仍停止。部署期间 Run 数不变，未调用真实模型，也未重试播放器需求。

部署记录：`.tmp/author-current-conversation/local-deployment.json`。
回滚备份：`/home/saya/workspace/Chrona/.tmp/kernel-minimization/local-deploy/rollback-author-current-20261109T115250Z`。
部署日志：`/tmp/chrona-author-current-deploy.log`。
