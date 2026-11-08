# 内核与内置应用瘦身：阶段 4–7 联合验收

日期：2026-11-08。阶段 1–3 已分别提交；阶段 4–7 按文件所有权并行实现，最后在同一源码快照集成验证。

## 实现范围

- 删除 kernel `memory`、`history`、聊天/偏好门面及其 Provider 原生工具；保留受真实调用身份约束的 Agent context、Provider continuation、构建会话事实、单一 Run 队列、授权与实际停止证据。
- 入口应用直接发现并调用获准的记忆应用。跨应用记忆贡献发现只开放给当前活跃、已批准且 hash 匹配的真实入口；其他 contribution 仍限其收件应用。记忆偏好、禁用、脱敏、已召回/已保存水位由应用维护。
- 旧 wake 定时通过停止状态下的显式 CLI 操作迁往核对过身份及已批准版本的入口应用；保留定时标识、规则与下一触发时间。入口将触发接入自己的私有 journal、后台 lane 和幂等收据，不把旧会话 ID 当作权限，也不猜测 QQ 收件人。
- 内核 `settings` 仅管理模型治理及预算时区；构建治理归 `modules.build-settings`，授权规则归 `approvals`，通知设置归通知应用，记忆偏好归记忆应用。Web/MCP 在应用侧组合视图和派发写操作。
- `projects.create` 只在 host 配置的、调用者绑定的目录范围内创建安全逻辑名称；Coding 持有默认项目选择。AGENTS.md 由 Coding 指示 Provider 使用原生文件工具、在每轮实际执行 cwd 中读取，不再由 kernel 注入规则内容。
- OAuth 的 HTTPS 端点和授权参数属于获准 manifest；挂起授权冻结定义，凭据绑定定义摘要，变更需重新确认。共享旋转 refresh token 的刷新按凭据/定义协调，每个调用者仍独立复核授权；保留 state、PKCE、Google 离线参数及 Microsoft `offline_access`。
- 仅 Agent/Web/notify 为内置应用；MCP/files/events 为可选外部应用，保持原 moduleId、自定义代码与数据，不因重启重新安装。MCP 删除仍需明确删除审批、备份、依赖检查、无运行/未知停止/待处理调用。保留的内部 Agent context 本身不是活动业务会话，不能使已空闲 MCP 永久不可删除。
- immutable rescue 不提供聊天，只处理审批、暂停和受检查的回滚；停止服务后的 official catalog/install 恢复不依赖 Web 或 MCP。

## 数据和外部客户端边界

`chrona admin legacy <request-file>` 提供 export / verify / delete / migrate-wake，均持有独占数据库运行锁。删除要求显式会话列表、已核对的 manifest SHA-256 和 `authorizeDelete: true`；先验证导出与当前源快照，再删除允许范围内的旧消息和附件。保护 Agent contexts、执行结果、Provider/Run 证据及共享附件。旧 Session 仅保留维持证据关系所需的归档记录，不宣称整张会话表被清空。

这些操作只在临时数据库和文件夹验证；**没有对既有用户数据执行迁移或删除**。既有全局偏好/旧应用版本也没有被自动迁移或覆盖。升级既有数据实例前须另行安排显式的应用配置/偏好转移与备份核对。

按用户范围，仅修改 Chrona；外部 `agent-workbench.nvim` 仍使用已删除的 `content.read`，其旧结果读取明确不兼容。临时 Neovim 集成检查这一失败及新的 `coding.read-result` 所有权/不可变结果边界，不宣称旧客户端结果 UI 验收通过。

## 验证记录

最终联合门禁均通过。全量测试期间运行时及测试源码未变化，只更新了文档；没有失败文件或 runner 重试。

| 检查 | 最终结果 | 日志（`.tmp/kernel-minimization/` 下） |
| --- | --- | --- |
| `bun run typecheck` | 通过 | `stages4-7-typecheck-final.log` |
| `bun run lint` | 通过；仅既有允许的 doctor complexity 提示 | `stages4-7-lint-final.log` |
| `bun run test:bun` | 165 文件，1664 pass / 0 fail / 7 skip | `stages4-7-final-test-bun.log` |
| `bun run test:api` | 21 文件，76 pass / 0 fail / 3 skip | `stages4-7-final-test-api.log` |
| Linux x64 发布构建 | 通过，12 个模块种子与源码严格一致 | `stages4-7-build-local.log` |
| 构建认证回归 | 6 pass / 0 fail；无/错误 Bearer 为 401，正确 Bearer 为 200 | 同发布构建日志 |

重型命令使用共享锁串行执行、8 GiB 内存上限、1 GiB swap 上限；全量测试并发为 1。skip 为已有隔离/环境条件，不代表该环境通过。发布构建使用任务本地种子副本延续现有模块历史，没有覆写已发布种子或放松源码校验。Bun 输出过非致命的 directory mismatch 内部提示，构建退出码为 0。

已完成的专项验证包括：记忆贡献权限边界、旧审批不再恢复退休聊天、导出/摘要/共享引用/容量与删除边界、CLI 独占锁、wake 重试及 unknown-stop、OAuth 定义和共享刷新竞争、可选应用删除/重装、不自动重装、实际 SDK 与临时 SQLite 集成。

真实浏览器最终记录：`.tmp/kernel-minimization/stages4-7-browser/run-1794144322/results.json`。三尺寸 `1440x900`、`1024x768`、`390x844`，39 项行为/布局结果；覆盖实际表单保存与读取、私有附件上传/发送/下载、真实 rescue 审批/暂停、空状态。修复设置保存响应写入错误层级造成的崩溃，重新运行通过；无横向溢出、脚本异常、console error、HTTP 错误或外部请求。通知列表、Agent 和模型执行使用隔离 fixture，不是实际消息发送或模型验收。

## 本地部署范围

现有 `chrona-v1-preview.service`（127.0.0.1:3111）与其数据保持不变。新版本已启动为 `chrona-kernel-preview.service`，仅监听 `127.0.0.1:3112`。发行目录及全新数据位于 `.tmp/kernel-minimization/local-deploy/`；认证配置 `config/service.env` 权限 0600，密钥未输出。此隔离预览没有配置真实模型执行。

实际发布二进制启动后只读 HTTP smoke 通过：静态页 200；缺少/错误密钥均 401；正确密钥读取组合设置、应用列表、接口元数据均 200；`/health` 200。初始实例没有自动安装可选 MCP/files/events；既有 3111 实例健康检查仍为 200。证据：`.tmp/kernel-minimization/local-deploy/smoke.json`。

这是隔离本地发布及启动验收，不是既有数据实例升级，也不是实际模型/QQ/通知发送验收。不访问 chino，不推送或远程部署。
