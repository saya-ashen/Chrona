# 当前对话 Agent 创作与固定材料提交

状态：当前源码增加了聚焦创作指引和可经现有文件工具保存的验收工作表；此修复未部署、未调用真实模型。下文「历史验证」「本地部署（历史）」记录的是此前 3112 版本，不能证明本次修复已部署或通过真实产品验收。

用户已批准使用当前对话的 Agent 编写应用，并通过 Author 提交，沿用现有候选检查与审批。Author 不需要另起模型执行器；本轮不新增内核 API、执行队列或权限。现有内核仍为五个公开命名空间、32 个工具。

## 实际路径

1. 当前对话 Agent 通过已有的真实入口身份发现工具与当前批准的 Author moduleId/hash，并确定完整目标及更新时的活动基线。
2. `author.prepare` 生成 `kind:"material-preparation"`、request、admission 草案、prompt 和 `acceptance:{path,content}` 工作表模板。它是纯函数：不启动模型、不写文件、不签发授权、不提交、不安装。当前 Agent 通过已有 `author.write` 显式保存工作表。
3. 真实 owner 入口经 `modules.admit-candidates` 签发绑定当前 Author 提交身份、全部目标和精确基线的一次材料准入。Author 自身不具备签发权限。准备结果中的身份不是授权证据。
4. 当前 Agent 使用 `author.write/read/list` 编写和检查 Author 私有源码。更新已有应用时可通过 `author.source` 读取准入覆盖的精确基线。必要时 `author.stage` 整理材料。
5. `author.submit` 以实际 Author 模块身份转交整个固定集合。内核冻结材料、保存唯一回执并进入检查；调用参数不能冒充模块身份。
6. `author.receipt` 使用精确 receiptId 或 admissionId/requestKey 查询检查与审批。丢失回复时保留原 key，不自动换 key 重投。通过检查、批准与实际激活各有独立证据，pending 不表示完成。

当前 Run 的权限、工具目录、租约、取消、期限及预算继续生效。材料准入仅授权材料提交，不授权新的模型执行；无需把两者绑定成第二套执行授权。普通无 owner 权限的入口不能借此签发准入或调用 owner 工具。

## 聚焦创作与持久验收工作表

针对 Chat 创建复盘中「窄范围替身测试通过、安装获批，但真实功能和视觉验收仍无人续接」的缺口，创作先做最小真实纵向集成：普通应用入口、实际 SDK/Store 路径、激活注册和一个用户动作接通目标宿主，再扩展功能。真实宿主或工具缺失时尽早记为 `blocked`，说明缺失条件；替身适合开发，不能替代真实宿主验收。

`prepare.acceptance` 可直接作为 `author.write` 的参数，路径形如 `sources/acceptance-<id>/checklist.json`。id 由原 requestKey 和完整目标集确定，不使用用户文本作为路径。先 `author.read`；只有 `not_found` 时写入新模板，已有文件必须分页读完并保留原证据。随后记录工作表路径到原任务交接。它与待提交的 `sources/work` 或 `packages/release/source` 分开，不能随应用材料一起 import/stage/submit；因此激活后的补充记录不会改变候选材料，也不要求重投。

这是调用方维护的普通 JSON 文件，不是平台核验过的验收结论，也不是新内核状态或审批门禁。已有文件机制保存它；当前 Agent 和交接中指定的负责人后续读取、更新，至少保留至验收与交接完成。Author 不自动清理、轮询、唤醒或恢复任务。

每个目标的初始行分开记录最小真实集成、候选检查、安装许可、实际激活、替身功能检查、真实宿主功能检查及真实宿主视觉评审。各行初始均为 `not-run`，候选与活动 hash 为 `null`；目标里的 `expectedActiveHash` 只是准入基线。当前 Agent 应把功能行展开为每项实际需求、场景和目标，填写：

- `status`：只用 `pass`、`fail`、`blocked`、`not-run`。通过须有实际观察与证据位置；失败写预期和实际；受阻写缺失条件；未运行不能变成成功。
- `moduleId`、`candidateHash`、`activeHash`：从原固定回执及匹配激活结果取得精确身份。缺少匹配证据时保持未知，不用基线或其他版本代替。
- `environment`、`hostVersion`、`provider`：明确 candidate、fixture 或 real-host，以及真实/替身 Provider、宿主版本。真实 UI bundle 放在 fixture 中仍属于替身证据。
- `scenario`、`expected`、`observed`、`evidence`、`reason`、`reviewer`：记录命令或用户动作、预期、实际、日志/截图位置、阻塞或未执行原因和评审人；不保存凭据或私密聊天内容。

候选或活动 hash 变化时保留旧行，给新版本新增 `not-run` 行，不能沿用旧版本的通过。候选检查退出码、注册成功、health 和截图生成分别只有其自身证明范围。

功能与视觉单独评审：功能覆盖实际需求中的首用、长内容、执行、问答、错误、停止和恢复等场景；UI 的视觉评审在实际宿主检查首用就绪、主次层级、阅读和输入空间、长内容、交付状态、桌面/窄屏、焦点/滚动和主题，附场景、尺寸、截图与具体判断。无横向溢出不等于视觉通过。无 UI 的任务把视觉行保留为 `not-run` 并写明范围原因。

**安装许可不等于产品验收。** 等待审批或结束当前 Run 前，更新 `admissionId`、原 requestKey、`receiptId`、精确版本、剩余行和 `continuation.responsible/nextAction/blocker`。明确谁在原任务审批后继续、如何查询原回执及匹配活动版本、还要完成哪些真实功能/视觉场景。无人承担时明确记录负责人缺失的阻塞；不静默批准、不虚构完成。

当前实现提供指引、模板和现有文件持久化路径。它没有强制验收 gate、自动恢复或审批后自动续接。主集成仍需把工作表路径、负责人和待验收项接入原任务交接/审批展示，并由现有任务继续机制消费；这些集成不在 Author 本次修复内，也不能据此声称已经实现全自动恢复。

本次仅运行 Author 定向测试 `bun test ./packages/engine/src/modules/steward/external/author/{author,material}.bun.test.ts`：15 项通过、0 失败。测试覆盖模板初始未知身份与 `not-run`、多目标检查范围、真实 SDK 子进程中的显式保存/分页读取/更新、重复 prepare 保留证据、子进程停止后磁盘记录仍在，以及更新工作表不改变暂存应用材料。SDK 测试使用临时目录和替身 kernel；这些检查不证明真实宿主功能、视觉质量或审批后续接已验收。

## 历史修改

移除 Author 返回的 `execution.supported:false` 和“缺少受限执行器”的阻断说明。`prepare` 输出及 Manifest schema 同步为材料准备结果，prompt 指明当前 Agent 继续创作、真实入口签发准入、Author 实际身份提交的分工。同步普通 Author 测试、根策略测试及当前边界说明，保留现有提交、检查、审批与数据损失守卫。

## 历史验证

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


## 本地部署（历史）

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
