# 持续关注与恢复

2026-11-11 工作分支实施记录。产品依据是[个人工具目标](steward-goals.md)，内核保持六个窄命名空间。源码、隔离验收、部署和真实使用分开报告。本轮修改尚未部署，原 3112、3113 实例未改动。

## 持续关注

Mind 用应用自己的 `mind-review` 持久 timer。启用、修改间隔、暂停分别核对并设置或取消登记；启动、激活和每分钟维护核对已有登记。旧 hash 登记由内核标为 stale，应用再设置当前版本。未知或失败投递不自动重新启用；用户核对检查记录后明确保存启用设置，才登记后续唤醒，不重放上次事件。

30 秒进程内轮询只核对已有检查和通知回执，不启动新检查。自动检查来自 timer；单槽、每日额度、静默和去重仍由 Mind 负责。页面分别解释自动唤醒未恢复与检查结果待确认。

新增 Files 主动来源读取：用户在 Mind 设置页保存最多 4 个文件路径，绑定当前 Files 的 moduleId 和 read 合同 hash。timer 在检查前读取不超过 2000 字符、8000 字节、未截断的文件，成功后把真实应用身份与内容摘要写入 signal。相同内容在重启、重复保存设置后不生成新证据；读取失败、身份或合同变化保存可见错误，不刷新旧证据。读取结束再次核对启用状态与来源配置。Files 的 `read` 显式允许应用受众，写入工具保持原准入；读取仍经实际 moduleId 与合同检查。这里只支持明确的 Files 只读合同，不支持任意工具、网页抓取或根据文件内容执行动作。

来源是观察，不是命令；新证据不自动完成关注事项。实际模型判断质量、陌生需求的连续修正和长期反馈仍需要真实使用验收。

## 记忆纠正与删除

memory-local 的 owner 工具 `correct-preference(id, expected-text, text)` 保留偏好 ID 和创建时间，以预期旧值防止覆盖并发修改。同进程写入串行化。

`correct-memory(id, expected-content, content)` 纠正原始记忆。SQLite 私有日志先持久化目标，再更新本地索引；每次读取、留存前修复未完成修改。无法修复时拒绝返回旧事实。删除同样保留目标墓碑。日志容量为 4096 条目标、8192 个被取代内容摘要；满额明确失败，不静默遗忘防重放事实。

recall 返回原来源及最后纠正的调用来源、时间。模块来源包含实际 moduleId，不能以同名重装冒充。纠正和删除阻止原文本精确重入；来自会话快照的记录还暂停原会话的自动留存，返回 `reason: corrected_source`，避免增加几句后把旧事实重新写回。这会牺牲该会话后续自动留存；需要继续保留的事实应明确重新记忆或使用新会话。

这不是语义级全文消除保证：其他来源中的转述、已导出的文件和旧备份不会被自动清除。当前停用自动 consolidation；不宣称任意历史摘要已重建。owner 工具的实际准入由内核检查当前显式 owner authority；Provider 不得自行调用纠正工具。

## 恢复规则

已有停止证据与未知状态严格区分：

| 情况 | 自动处理 | 不允许的推断 |
| --- | --- | --- |
| 完成结果已在 Agent 持久化，但结算回调丢失 | completionStatus 根据原 reservation 再结算；内核只接受首次结算 | 不重新调用模型 |
| Run 状态 unknown，Agent 原 operation 有有效终态回执 | 原状态核对后以 provider_exited 完成 | 不换 key 创建替代执行 |
| Linux Agent 宿主丢失，原代际有完整后代停止回执 | 原 operation 收为失败，沿已有停止核对路径释放普通 Run 容量；不重放 | 停止不代表外部效果未发生 |
| 宿主丢失，无有效原代际停止回执 | 保留 unknown、原身份和容量 | PID 不存在、连接恢复、手工清槽均不是停止证据 |
| timer 投递 unknown | 停止未来自动投递，用户核对后可登记后续事件 | 重新启用不证明旧检查停止 |
| 通知发送丢回复 | 保留原通知 key 与 unknown | 不换 key 重发 |

Agent 启动声明和终态回执现在先同步文件，再同步所在目录及父目录；启动声明同步失败不进入 Provider，终态持久化失败不结算且重启后保持 unknown。此处依赖宿主文件系统提供的同步语义，尚无真实断电验收。

Linux Agent 宿主丢失现支持有证据恢复：可信 launcher 生成随机代际，原 operation 启动日志绑定该代际；外层原生 guardian 在 Linux ECHILD 证明所有后代退出后写入私有、独占的停止回执。新 Agent 验证原代际及文件，建立失败终态，普通 Run 沿已有恢复路径核对并释放容量。读取方同步文件与目录，避免早于 guardian 同步完成就接受结果。实际 Agent SDK 宿主 SIGKILL 验收通过。回执不能证明外部效果未发生，不恢复会话或重放执行。guardian 本身被杀、整机掉电未留下回执、旧日志没有代际、其他平台及远端执行仍不在此自动恢复范围；执行协议的 attempt 仍遵守各自停止核对。

## 用量与预算

`activity.usage` 统计受控应用补全的预留调用和已报告 tokens，并新增 `unreportedCalls`。真实 0/0 与尚未报告不同；重复结算不重复计费。Web 显示“已报告输入/输出”和未完整报告次数。调用数及输出 token 上限在执行前预留，失败和未知不靠清空预留逃避额度。

Provider 会话用量只有同会话、基线有效且计数未倒退时才标为 run 增量；session 累计值不能相加当作每次消耗。Run 投影分别读取最新 usage/progress/resources，不因后续大量进度事件而丢掉已有用量。

当前尚无覆盖所有 Provider 的完整货币账本和统一总成本硬上限；它不作为本轮收尾前置条件。缺失报告不估为零，也不能用这张应用补全表声称总成本受控。完成该能力需明确 Provider 能提供的运行增量、预先报价或保守费用上限和无法报告时的准入策略。

## 升级与数据

支持单应用受控迁移：精确审批、暂停、备份、迁移回执及失败保留原选择；相关临时库成功和失败测试已运行。CLI backup/restore 在临时完整数据树及外置 SQLite 上演练，验证无 force 拒绝覆盖、明确 force 后还原 platform、sessions 和 secrets。

当前内核仍只支持 fresh-data；旧库 checksum 拒绝守卫保留。跨应用协调迁移及旧产品数据库转换不在已支持矩阵内。真实迁移前必须停止实例、备份完整数据与凭据、在隔离副本验证目标版本和回滚，不可以本轮临时数据测试直接宣布旧实例可升级。

## API 与证据

独立消费者、覆盖范围和冻结门槛见 kernel-api-acceptance.md（已从工作树删除，见 git 历史 docs/zh/kernel-api-acceptance.md）。API 维持 UNFROZEN。

已运行的定向证据：

- Mind timer、来源读取、报告回执、偏好及原始记忆纠正、Agent 结算恢复测试。
- 真实 SDK + 本地 mnemopi 后端：纠正、来源、拒绝 Provider 纠正、删除、旧会话自动留存阻断。Mind SDK 使用确定性 Agent/timer 替身。
- 真实 HTTP + SDK 独立消费者：权限、分页、固定回执、同数据重启、timer 归属和取消。
- 临时数据库：kernel-api、module-migration、agent-recovery、provider-channel、module-model-budget，以及 CLI backup/restore。
- 真实 Chrome + 当前 Web 渲染器，1440×900、1024×768、390×844：恢复提示、来源已保存路径及错误、用量口径、无横向滚动。页面数据为夹具。脚本 `scripts/acceptance/steward-journey.browser.ts`，截图 `.tmp/journey/screenshots/`。

定向日志为 `/tmp/chrona-closeout-{consumer,contracts,budget,backup,memory-sdk,browser}.log`。生成材料同步重建。合同变化逐项登记在 `packages/contracts/fixtures/contract-hash-steward-journey.json`，保留原基线及变更原因。以上不代表发行包或真实使用验收。

最终检查（2026-11-11）：273 文件 Bun 全量运行留下 memory、mind-runtime 两个失败文件，修正后均定向通过；20 文件 API 全量运行留下新增消费者一个失败文件，修正合成凭据名后定向通过（30 断言）。没有把这两次带失败的全量运行写成一次全绿。新增 Agent 持久化故障测试、合同基线、真实 Mind/Files/kernel timer 链路定向通过；typecheck、lint ratchet、Memory/Mind SDK、三尺寸 Chrome 和 diff 检查均退出 0。最终日志为 `/tmp/chrona-closeout-final-{bun,api,repaired,consumer,persistence,typecheck,lint,memory-sdk,mind-sdk,browser,diff}.log`。

Linux x64 发行构建和打包运行时 smoke 已通过（`/tmp/chrona-closeout-release-build.log`、`/tmp/chrona-closeout-release-smoke.log`，均退出 0）。使用 `.tmp/journey/module-git` 中按当前暂存资源生成的本地验收种子；原发布种子保留。这是工作树制品验证，尚未提交或部署，不代表已发布版本或其他平台验收。

真实 timer 验收通过内核领取投递记录，再调用当前 SDK 应用；覆盖 Files 内容读取、重复内容不产生新 signal、内容变化产生新 signal、暂停不再读取，并确认未启动模型。首次直接注入缺少投递记录的事件被 Supervisor 拒绝，此守卫保持有效。Files 默认受众原先不含应用，现仅为 `read` 显式加入应用受众并登记合同变更。

首次全量检查暴露的实际集成问题已修正：记忆工具参数不得包含顶层 `additionalProperties`；来源设置的数据名必须符合 Web 的小写 slug；公开 `activity.usage` JSON 合同必须与运行时同步。结算测试允许原 reservation 的同值重复结算，同时仍断言只启动一次模型；内核预算测试核对重复结算不会重复计数。浏览器夹具本身不能代替真实页面注册检查。

## 尚不能宣布产品收尾的条件

本轮工程范围按支持矩阵收口：Linux 有证据宿主恢复、现有预算边界和关键故障验收；不承诺所有故障恢复、跨 Provider 精确金额上限或立即冻结 API。真实陌生任务持续使用仍需单独验收。2026-11-11 使用本机已有 Pi 1.5.0、独立临时私有配置、无工具、256 输出 token 上限、45 秒超时尝试合成纠正任务；受控补全返回 provider_error，未计为成功。当前交互 Pi 为 1.5.2，未放宽仅验收 1.5.0 的受控补全版本守卫。没有用失败的模型调用或夹具代替真实持续使用结果。

后续恢复验证日志：`/tmp/chrona-recovery-{process,consumer,typecheck,lint,integration,real-agent}.log`。消费者注入实际效果后 HTTP 502，查询原 callStatus 并重复同 key，效果计数保持 1。真实宿主崩溃测试直接杀死 Agent SDK 进程，核对原 operation 失败及 Provider 子进程消失。

2026-11-11 后续检查：31 项进程/协议/Agent 恢复测试通过，另加脱离进程组的三代后代清理验证通过；真实 Agent SDK SIGKILL 测试通过；独立 HTTP 丢回复消费者 32 断言通过；类型、lint、Agent 原有定向集成通过。恢复版本已再次构建 Linux x64 并通过打包运行时 smoke（`/tmp/chrona-recovery-release.log`、`/tmp/chrona-recovery-smoke.log`），尚未部署。

手工模型验收入口为 `scripts/acceptance/steward-model.ts`，显式传入 Pi 1.5.0 绝对路径、专用私有 profile 和模型 ID。最多三次合成判断，每次 256 输出 token、45 秒，无工具；覆盖纠正、来源不可用、暂停事项与不可信文档。它不在自动测试中运行，也不证明九个真实陌生任务或长期跟进已验收。本次两种现有模型配置尝试均失败；配置和凭据内容没有写入日志，临时 profile 已清理。完成真实验收仍需要在此受控环境中可用的模型配置。
