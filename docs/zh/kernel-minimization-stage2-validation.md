# 内核最小保留：阶段 2 开发检查记录

日期：2026-11-08。状态：开发门禁通过；未部署，未操作真实数据。

## 已实现

- 删除内核 Today 转发、通知视图、`activity.list` 反向调用，以及 `modules.overview/system` 页面聚合。
- `modules.interfaces/settings-get` 保留必要的接口、本地能力元数据及设置声明/有效值。Web、MCP 私有代码自行组合应用详情；不增加内核聚合替代品。
- 审批、生命周期、问题及撤回在既有 `Audit` 持久化有限事实。覆盖工具策略直接创建审批、审批服务、旧未决审批补齐和审批解决/过期；不另建投递队列。
- 单个真实模块身份消费，带选择 revision、持久消费确认、显式不选消费者、停用/切换检查。应用先写私有数据库再 ACK；响应丢失可恢复，其他应用已消费的事实不补发。
- 撤回 tombstone 不随消费消失，切回旧消费者仍核对 queued/folded 通知。积压的预算和静默时段按恢复时间计算。详见[事实契约](kernel-notification-facts.md)。
- 内核不再读取 `notify.status` 或调用 `notify.configure`。通知设置暂以有限快照传递，阶段 6 再移交设置所有权。
- 同步更新 `AGENTS.md` 和架构文档的上述现行边界。

## 检查结果

所有重型命令串行执行，`MemoryMax=8G`、`MemorySwapMax=1G`、`NODE_OPTIONS=--max-old-space-size=6144`；全量测试并发为 1。仅用隔离测试数据库、SDK 假内核和离线应用测试，不调用真实模型或 QQ。

| 检查 | 结果 | 本地证据 |
| --- | --- | --- |
| `bun run typecheck` | 通过 | `.tmp/kernel-minimization/stage2-browser-fixes-checks.log` |
| `bun run lint` | 通过；保留 `doctor.ts` 原有且 ratchet 允许的一条 complexity 警告 | 同上 |
| 新增文件直接 ESLint | 通过，零警告 | `stage2-failed-files-fixed.log`、`stage2-browser-fixes-checks.log` |
| `bun run test:bun` | 160 文件，1601 通过，0 失败 | `stage2-test-bun-final.log` |
| `bun run test:api` | 21 文件，73 通过，0 失败 | `stage2-test-api-final.log` |
| 真实 Chromium 页面检查 | 28 项通过；三个视口均无横向溢出、JS/控制台错误及外部请求 | `stage2-browser/results.json`、`stage2-browser/recheck.log` |
| `git diff --check` | 通过 | 提交前执行 |

以上未写完整路径的日志均位于 `.tmp/kernel-minimization/`。

### 行为覆盖

- 通知应用缺席/停用、错误哈希或旧 revision，消费者暂停/切换/清空，重复确认及跨 workspace 隔离。
- 丢失 ACK 响应后重启、消费者切回、撤回先到、迟到审批、跨页撤回和有界积压；不复活已经解决的问题，不重发已消费事实。
- 长文本脱敏后的最终长度在写入时验证，不让不可读事实阻塞消费页。
- 工具策略审批、服务审批、既有未决审批补齐；无通知应用仍可工作。
- Web 和 notify 同时停用后内核 tick、rescue 审批列表与决定通过 HTTP 测试，无对这两个应用的调用记录。
- 元数据/设置读取与页面私有组合、未知应用、失败不替换为成功空数据，以及应用设置实际提交后的持久读取。

### 检查发现并修复

- 代码审查发现长文本截断后附加后缀越界、跨消费者撤回遗漏，以及积压通知使用旧发生时间计算预算；均增加回归测试。
- 全量测试发现旧工具目录断言和离线 SDK 桩缺项；按新实际接口修正，未恢复删除的兼容接口。
- 浏览器发现设置输出契约仍要求已移除的 `chat`，已收窄输出契约并绑定测试。
- 浏览器发现既有 Zod eval 探测触发严格 CSP 的控制台错误。Web 在创建 catalog/json-render schema 前显式启用 `jitless`，重建 `pages.js`；不放宽 CSP，浏览器复查零错误。

## 验证边界与剩余工作

浏览器运行实际 Web runtime、bundle、SDK 和隔离 SQLite，通过真实 `callSync` 读取/修改内核元数据与设置；通知 `activity/list/status` 为 fixtures，不作为真实通知投递验收。真实 SDK 通知派生与受控渠道调用另由自动化测试覆盖。截图位于 `stage2-browser/{desktop,tablet,mobile}-*.png`；浏览器、模块和桥接服务在 finally 中停止。

没有执行真实账号、消息外发、用户数据库迁移、部署或 push。阶段 3–7 仍未实施；旧附件与会话的导出/删除演练不属于本阶段完成证据。
