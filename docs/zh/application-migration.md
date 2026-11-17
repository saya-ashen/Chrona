# 普通应用的新内核适配

> 当前状态：Coding 与 coding-web 已退役，包含旧 work-v2；当前 Chat 独立拥有会话与执行记录。本文的 Coding/Editor 接口、源码路径、验收和部署描述仅作历史记录，不是现行接入指引。详见[Coding 退役说明](coding-retirement.md)。

状态：全部 13 个普通应用源码适配、离线验收、关联全量回归和 Linux 发行材料检查完成。工作分支 `work/kernel-agent-migration`，基于已合入的 `b65e7ece` 与未提交内核迁移。当前记录不代表部署或真实账号验收。

## 范围与应用清单

本轮覆盖 `external/` 的全部 13 个普通应用。保持原有安装、审批、数据丢失、实际停止和暂停边界；没有增加内核业务 API，没有启动真实模型、外部账号或向外发送通知。只使用临时数据库与离线替身。Remind 继续暂停，memory-local 定期整理及 Mind 自动检查/通知保持关闭。

| 应用 | 本轮处理 |
| --- | --- |
| Web | 消费真实 Run 的持久工具结果；保留自身会话、设置、页面和内容所有权；浏览器检查三种尺寸 |
| QQ | 同步入口回执实现，补齐独立 Zod 依赖和冻结锁；离线 SDK、审批、格式与配置检查 |
| MCP | 同步入口回执实现，补齐独立 Zod 依赖和冻结锁；离线 HTTP、身份和会话检查 |
| Notify | 验证事实消费、撤回、确认、渠道绑定、未知投递与应用私有政策 |
| Author | 验证完整材料往返与固定准入；更新与上游当前安全提示一致的测试断言 |
| Files | 验证独立 SDK 与受检安装、私有内容、历史、回收和路径边界；修复安装测试中的 Agent 依赖夹具 |
| Events | 验证登记、真实目标身份与合同、回调结果和未知效果不重放 |
| memory-local | 安装既有锁定依赖用于独立离线检查；验证召回、保留、偏好和会话水位；不恢复周期整理 |
| Mind | 报告确认迁到真实 Run 的完整持久工具结果；分页游标与报告同次保存，失败页重启续读；不从模型文字或 transcript 验证报告 |
| Coding | 验证原调用身份、项目引用、会话命令、执行回执与成果读取 |
| coding-web | 验证客户端命令协议、选择与草稿所有权、页面登记 |
| remote-execution | 验证既有私有宿主协议、设备/激活身份、预算和停止证据；不启用通用远程模块托管 |
| Remind | 移除旧 Manifest 字段与 `schedules.*` 依赖；应用私有 SQLite 保存日程、触发和 Notify 回执，源码离线验收，仍不允许安装/激活 |

## 回执与恢复

Web/QQ/MCP 的共用入口源码仍在 `entry-app/`，通过现有构建器生成各应用私有副本。`agent.stream.items` 中的持久结果绑定 Run、实际目标版本及合同；只有成功、完整、已选择工具的结果能建立提交关联。Author 结果还匹配回执中的真实 submitter 身份与版本。transcript 只供展示，不证明提交、激活或交付。

未知工具结果保留待核对的 callId，Run 结束后仍可读取迟到回执；重启不重新提交、不换请求键、不新建 Run。候选回执、匹配版本激活、观察健康、登记页面和浏览器行为保持独立事实。Mind 同样只使用持久报告事件，失败的分页保留上次成功游标，其他 Run、过滤结果及模型文字不能验证报告。

## Remind 的应用私有日程

新源码不注册或调用任何公开内核日程接口，也不消费 SDK schedule trigger。单个应用进程持有私有 SQLite 和本地 timer；日程可为一次、每日、每周或间隔，明确保存 IANA 时区与截止时间。每日/每周按当地时间计算，跳过不存在的 DST 时间；延误恢复只处理一次当前到期提醒，不补发所有错过次数。

触发在调用 Notify 前事务性保存 unknown 状态；同步成功后保存 Notify 的实际状态和通知 ID，再安排下一次。丢失回复、异常返回或进程崩溃留下 unknown，停止后续提醒且不自动重发。取消发生在发送过程中仍保持取消，不被迟到成功重新安排；已发起的外部通知无法由本地取消撤销。相同创建输入返回原记录，不会因重试重新启用已结束或已取消的提醒。数据 schema 更新为 2，仅验收全新临时数据，不迁移旧数据。

Remind 的暂停策略仍由现有 `module-availability.ts` 执行；恢复安装/运行需另行明确决定。本轮只是完成源码适配，不能从源码测试推断真实提醒已启用。

## 验证与证据

合同黄金向量保留原基线，新增 `contract-hash-kernel-app-migration.json` 逐项解释 9 个合同变化；不会通过整体重录基线接纳意外变化。

本轮最终结果：

- 仓库 Bun 监管器覆盖 265 个文件：2843 项通过、0 失败、38 项跳过。完整首轮发现旧夹具、合同排列断言、Audit 权威状态断言，以及未使用配置 `CC` 的设备测试；修复后只补测受影响文件，最终按每文件最后一次结果汇总，不把失败尝试计为通过。
- 服务器 API 全组覆盖 19 个文件：104 项通过、0 失败。救援入口的旧 Audit 通知断言改为验证事务性 `KernelFact`，单文件以新临时数据库补测通过。
- Web React 组件 3 个文件：23 项通过、0 失败。三组合计 **287 个文件、2970 项通过、38 项跳过、0 失败**。跳过包括 Windows/macOS 特有行为、实际 Pi/设备和受条件约束的远程模型检查；不把这些条件推断为已验收。
- 三种尺寸的真实无头 Chrome 检查通过：1440×900、1024×768、390×844，共 50 项 shell、路由、应用页、登录和错误状态检查，手机无横向溢出。
- 全部 13 个应用在临时目录重新按自己的冻结锁离线安装依赖（有 package.json 时）、使用当前合同独立类型检查，并执行自己的 SDK 自测。Remind 的测试运行不会解除暂停。
- 全仓 TypeScript（已移除 Remind 的旧排除项）通过；lint ratchet 相对 `b65e7ece` 通过，126 个变更文件、0 错误、5 项基线允许警告，无新增逐文件债务。Remind 的旧 lint 排除也已移除；纯测试帮助代码放在 `reminders.test.ts`。
- 正常发行构建流程重建 `linux-x64` 二进制和归档；静态 release smoke 与隔离临时数据的编译二进制 `/health` 通过。14 个发行材料仓库均验证包含上游版本历史；相对 `b65e7ece` 只更新 Web/MCP/Agent/QQ/Remind/Mind，其余应用保留上游版本。
- `git diff --check` 通过，没有冲突或暂存改动。原仓库干净，当前工作分支仍含未提交实现；未创建代码提交、推送或部署。

可复核命令为 `CHRONA_TEST_CONCURRENCY=1 bun scripts/run-bun-tests.ts`、`bun scripts/run-api-tests.ts`、`node node_modules/typescript/bin/tsc --noEmit --pretty false`、`LINT_RATCHET_BASE=b65e7ece bun scripts/lint-ratchet.ts`、Web 的 `shell.browser-test.ts` 与三个 `src/*.bun.test.tsx`。实际环境使用本机 Nix `CC` / Prisma engine，重型命令串行运行，`NODE_OPTIONS=--max-old-space-size=6144`。

日志位于本 worktree `.tmp/application-migration/`：`full-bun-tests.log`、`final-retests.log`、`final-fixtures.log`、`remind-final.log`、`api-tests.log`、`rescue-api.log`、`ui-tests.log`、`browser-shell.log`、`typecheck.log`、`lint.log`、`package.log`、`release-smoke.log`、`kernel-health.log`。`bun-result.json` / `api-result.json` / `ui-result.json` 保存逐文件最终结果与实际日志归属；`material-ancestry.json` 保存材料版本父链证据，`result.json` 保存汇总。既有内核阶段的 891 项和上游整合的 122 项记录从 Git 历史 `docs/zh/kernel-agent-migration.md` 查阅，不重复计为本轮全量通过。

## 合回原分支

用户明确要求合回原分支。整合前 `platform-v2` 工作区干净，与迁移分支同为 `b65e7ece`；将上述已验证的内核与普通应用成果形成迁移提交，再快进合入原分支。本地 `node_modules` 链接、临时数据、验证日志和编译输出不纳入代码提交。前述“未提交”描述本阶段验收时的状态，不限制这次用户明确授权的整合；没有推送或部署。
