# 事项优先：会议闭环实现与验收

状态：2026-09-17 本地实现和回归验证完成后，用户另行批准继续部署与接入；**已部署至 Chino 并完成真实传输／界面联调**。人工验收仍待用户。会议闭环指记录、跟进和审阅，不包括邮件／日历实际执行。

## 范围

复用 Task、手动生命周期、WorkBlock、TaskResult，不建立第二套任务库。实现登记、跨来源关联、外部进展／操作回执、改期／取消建议、待处理，以及对应前端。Goal 资产复用、旧 Run 成果统一属于下一轮。无邮箱／日历写回、通知、外部 Agent 唤醒或 Provider 改动。最初本地实施不授权部署；后续用户另行授权的部署记录见下。任何旧凭据仍不扩权。

## 领域与权限

- 一个 Task 可有一个事项档案；会议资料与通用记录严格校验。新登记固定 manual、无计划／执行／Provider。历史开放手动任务可显式启用，保留原 Task ID、时间块和成果；不转换托管、自动、重复或已关闭任务。
- 独立 work:read、work:write 权限和显式 CLI preset。旧凭据不扩权；写权限仅允许登记非自动事项及上报，不授权执行、任务完成或成果验收。
- 来源以 workspace＋kind＋system＋account＋externalId 定位，URL 只是展示，不进行抓取。重复捕获返回已有事项，不覆盖资料或顺带新增来源；多个来源指向不同事项时返回冲突，不自动合并。原生日历事件可通过 calendarEventId 复用已有任务关联，不创建第二套事件；来源拥有的时间块不能在本入口改写。
- 操作回执／用户决定由提交者上报；身份从认证上下文导出，不能输入 human／verified／permissionGranted。UI 区分来源声明与 owner 操作。
- 会议参与、邮件回复、日历处理与是否召开分别记录，不写入 task.status。发送结果 unknown 不转换为 sent，也不提供重发按钮。
- 改期／取消以带原事项 revision 的建议记录，只有 owner 确认可应用；冲突必须重新比较。拒绝建议、取消会议不撤销任何外部副作用。来源拥有的日历时间块不得经此绕过修改。
- 上报、建议、处理留历史。UUID 幂等、CAS、作用域检查、配额、有界分页在共享应用服务内实现。关闭新入口只读仍可用。

## 前端

- 有事项档案的手动 Task 默认事项工作台；没有档案的历史任务／托管任务保留原工作台，可显式进入记录页。
- 顶部：事项标题、时间／时区、来源说明、下一步；会议安全链接须用户点击。
- 概览、进展与回执、成果与材料清楚分组；使用现有成果 UI，不重新实现验收和附件协议。
- 新登记表单、关联来源、进展／状态上报、改期／取消建议及 owner 处理均有正常控件，不要求编辑 JSON。
- 待处理入口汇总未处理变更及需要核对的事项，保留已有执行审批队列，不替换其状态机。
- shadcn 基础控件，现有配色／字型，清晰留白与层级；响应式 1440×900、1024×768、390×844。所有文案 i18n。

## 验收

相同来源不重复创建；跨账号来源不错误合并；权限不扩大；无 Provider 时登记／记录／审阅成立；发送未知保持未知；改期接受只更新自己拥有的 Chrona 时间块；取消不关闭任务或发送外部消息；过期建议及并发更新拒绝；旧数据／成果／附件与托管行为保留。界面覆盖空、加载、错误、待确认、冲突、取消、已召开状态。测试包含 DTO/domain、共享用例、HTTP/MCP、迁移与三尺寸 E2E。

迁移保持唯一 mutable release line，登记已部署 B3 checksum amendment；已发布 SQL 校验和及原始字节保持不变。本地阶段未改线上数据库；后续明确授权的升级先备份／演练再执行，结果见下。未提交／推送。

## 交付与验证记录

入口：`/:lang/work`、有档案的手动任务默认详情页、行动中心的事项跟进区。原工作台仍可通过 `?view=execution` 进入。HTTP：`/api/work-records/*`；MCP：`chrona_work_search/read/capture/update`。完整契约与限额见[接口说明](../en/work-records.md)。

写入口由 `CHRONA_WORK_WRITES_ENABLED=true` 显式开启，其他安装仍默认关闭。新增 `work-read`／`work-record` 最小权限 preset，不扩大旧 `full`、成果或助理凭据。授权实例另发独立事项凭据并安装仓库技能，见部署记录。

最终通过：

- `bun run typecheck`。
- `bun run test`：Vitest 107 文件／814 通过；Bun 321 文件与 API 65 文件报告合计 2695 通过／11 跳过（两个 runner 覆盖有交集，不是独立用例总数）；旧 E2E 161 通过／16 跳过。
- 新会议 E2E 12 通过，旧成果 E2E 12 通过；分别覆盖 1440×900、1024×768、390×844。浏览器使用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/run/current-system/sw/bin/google-chrome`。检查移动端无横向溢出、导航可达、加载／错误／已关闭状态、旧成果保留、重试与过期建议。
- `check:ui-foundation`、`check:boundaries`、`check:release-consistency`；边界检查仍有 10 条原有测试文件警告，0 错误。
- `bun run chrona build linux-x64`、`bun run build:smoke`：打包、升级／备份／恢复通过；B3 合成库升级及空库指纹一致，已有数据保留。
- 新模块单独 ESLint 零警告；`git diff --check` 通过。

全仓 `bun run lint` **未通过**：仅两个本轮未改动文件仍触发原有 ratchet 阻断，`features/schedule/ui/forms/task-config-save.ts` 与 `packages/engine/src/modules/tasks/manual-task-lifecycle.ts`。未为过检查改动无关代码。

保留失败过程：前两轮全测分别因旧 MCP 工具数断言／新 PrismaPromise 断言，以及测试直接删除 Task 的外键问题停止；更正测试后完整重跑通过。会议 E2E 曾有 2 项捕获后导航等待竞争；改为等待任务 URL 和一级标题后 12 项全过。不能把早期失败日志说成通过。

本机日志与三尺寸截图：`/tmp/chrona-work-records/`，最终日志 `full-test-complete.log`、`e2e-work-complete.log`、`e2e-results-final.log`、`build-smoke-complete.log`；截图 `screenshots-final/`。这些是开发验证证据，不是线上验收。

## 授权部署与接入（2026-09-17 20:34–20:42）

- 冻结 1683 文件，基于 `cca19a55f2f71bf3e4c7b6807ce84984d2c75418` 加 138 个未提交文件；排除 7 个无关 Pi Provider／文档改动。不声称是干净 commit 或公开发布。冻结副本重新通过 typecheck、28 项针对性测试／408 断言、Linux 构建与打包升级／备份／恢复冒烟。
- Chino 包 `0.3.1-work-records-20260917`，在线／停服备份及真实副本迁移通过。迁移只新增 WorkRecord／WorkSource／WorkEntry／WorkCommand，原 75 表数据、20 个 Task、1 个 Goal 保留；目标指纹 `66b31a8dbe0bc6668b45c4775bf2bedc6e34c35eca0276ce5d02d5ea8b5f9b1d`。
- 只重启 Chrona，运行时与下次启动均启用事项／成果写入。Nix 闭包仅 Chrona／归档变化；没有全系统 switch／重启、TLS／网络或 Provider 配置变化。
- 新客户端 `pi-nikki-work-record` 仅有 `tasks:read`、`work:read`、`work:write`。Pi 新增 `chrona-work`，7 个 server-prefixed 工具；旧 `chrona` 11 工具和 `chrona-results` 6 工具及原权限保持不变。共享 MCP 配置未改。
- 实际 Pi adapter 验证 HTTPS、合并配置、命名无冲突、旧连接不可访问新事项工具、贡献者 `canResolve=false`。实际 skill loader 验证项目内外均唯一发现新技能。安装检查发现 YAML description 冒号未加引号；源技能／安装副本已修正，复测通过。此技能元数据修复晚于服务器冻结包，独立记录，不篡改冻结包来源。
- 复用原验收 Task `cmu5ba1750001s2fui92sud9d`，未新建 Task／日程。登记来源、两条历史及三条幂等命令回执；重复来源／重复请求不重复创建，模拟回复结果 unknown 保持未知，贡献者确认操作被拒绝。原任务字段、成果版本和附件不变；无新增 Run／Plan／ExecutionSession 或审阅。
- 浏览器观察 `/zh/work`、事项概览、进展与回执、成果与材料，原版本仍待用户验收。未点击接受／拒绝／要求修改。截图保存因浏览器工作区路径限制被拒绝，未绕过；此处证据为实际页面文本观察与服务端回读，不声称保存了线上截图。
- 最终复核 78 表原有行保持不变，仅允许正常 SchedulerLease／ManagementClient.lastUsedAt 更新；原凭据不变。证据本机 `~/.local/share/chrona-deploy/20260917-work-records/`，远端 `/var/lib/chrona-pi/deployment/20260917-work-records/`；备份留在远端私有目录。
- 当前 Pi 会话需 `/reload`。此技术联调不是用户真实会议接受／邮件发送／反馈修订全周期验证。

## 明确剩余范围

- 没有发送邮件、RSVP、写外部日历、通知或调度外部 Agent；不代替用户验收成果。
- 原生日历仅复用现有身份与手动任务关联；来源改期仍需在原有来源流程核对，不把记录状态伪装为实时同步事实。
- 跨会话 Agent 应持久保存请求 UUID 和精确参数；前端丢响应重试仅在当前页面会话保留。服务端幂等和来源去重不依赖页面存活。
- Goal 资产复用／接续、旧 Run 成果统一、外部 Agent 自动唤醒与通知仍属后续独立切片；已部署 B1–B3 的真实人工反馈／外部修订周期仍待用户验收。
- 无提交／推送；Chrona 原暂存区为空并保持不变，Nix 已有暂存区保持不变，无关 Pi Provider diff 指纹保持 `a6fc01fa068ef02a71d227517a7e3ecd55f97b68`。
