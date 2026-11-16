# 验证范围与证据

## 固定基准

- 主仓库基准：`6966a5c3`；任务分支：`refactor/cleanup-and-reorg`。
- `LINT_RATCHET_BASE=6966a5c3`，不随阶段提交漂移；ratchet 通过只证明没有增加逐文件 lint 债务。
- 临时数据运行；不调用真实模型、QQ 或部署环境。
- 证据目录 `.tmp/cleanup-and-reorg/` 不作为发行材料。正式入口 `bun run verify:release [report-directory]` 输出 JSON 报告、每步退出码、执行时长和完整合流日志。

## 本轮基线与修正

`baseline-r2/results.json` 保存实际退出码：check all 与 verify:slice --no-tests 通过；Bun、API、build 失败。全库 lint 原有 195 errors / 1036 warnings 为诊断债务，独立记录，不冒充全库通过。

Bun 全量扫描原为 343 文件，API 为 20 文件。新增发行脚本自测，并将已存在的 Chat state / DOM / host Agent 集成套件与 server 数据库安全测试接入后，发现清单变为 Bun 347、API 21。

已完成定向验证：

- MCP / Web inventory / Pi transcript：15 tests，通过。
- Mind control：9 tests，通过；未知停止持续保留 actor 与占用。
- 合同生成、Web 离线材料重建、today、Web Agent、打包 helper、Chat state / DOM / host 集成：8 文件，通过，日志 `remaining-fixtures.log`。
- 离线一次性 storage converter：9 tests，通过，日志 `migration-r2.log`。只使用临时数据；没有运行真实数据转换。
- HTTP execution-workbench 与数据库安全：7 tests，通过，日志 `api-r2.log`。
- 正式发行入口：2 tests，通过；覆盖合流日志、lint 债务单列、build 失败后不运行 smoke。

静态独立审查 `baseline-fixture-review.md` 未发现测试修复削弱可观察断言。第二轮独立诊断发现迁移真实漏验：摘要 list 丢弃 turns，已改为完整 session reader 验证；未以修改断言掩盖问题。新增 API 强断言覆盖 fence 禁止新 Run、重复 stop 的 abort 次数不变，保留 paused / 旧 hash 禁止读取与 unknown 占用行为。

## 未直接进入 Bun/API 清单的文件

清单上的“套件外”只表示未直接作为 runner 文件启动，不表示没有消费者：

| 文件 | 实际执行或验收入口 |
| --- | --- |
| `external/remind/reminders.test.ts` | `reminders.bun.test.ts` 与应用 `test.ts` 调用 `runOfflineChecks`，不可直接作为空 Bun 测试启动 |
| Web `src/chat.browser-test.tsx` | `chat-browser.bun.test.ts` 构建并在浏览器执行 |
| Web `src/settings-inline.browser-test.tsx` | `inline-settings.bun.test.ts` 构建并在浏览器执行 |
| Web `src/settings-timeout.browser-test.tsx` | `settings-timeout.bun.test.ts` 构建并在浏览器执行 |
| Web `src/workspace.browser-test.tsx` 与 `src/pages-loading.browser-test.tsx` | `react-pages-browser.bun.test.ts` 构建并在浏览器执行 |
| Web `shell.browser-test.ts` | 独立隔离 HTTP / 浏览器脚本；60 项通过，含三尺寸，见 `extra-checks/web-shell.log` |
| `scripts/agent-integration/settings-page.browser-test.ts` | 独立隔离同源 HTTP / 浏览器入口；修复旧装载 fixture 后 Pi / Notify 六个三尺寸场景通过，见 `settings-browser-r7.log` |
| `examples/desktop-demo/desktop-demo.bun.test.ts` | 独立桌面示例离线构建及 3 tests 通过；仅离线生命周期与材料，不证明真实窗口，见 `extra-checks/desktop-*.log` |

不把浏览器 fixture、实际应用安装与真实模型使用混同。阶段 9 的三尺寸页面验证与 chino 实际部署需各自证据。

## 当前完整复验

`release-r3` 在检查阶段拒绝了误放回源码目录的 Pi 构建 vendor 和 runner 新增复杂度；已将生成依赖保存在任务临时目录并恢复源码材料记录，拆出实际共享的测试发现函数。没有改 lint 规则或排除路径。

`release-r4/report.json` 已完成：check all 通过；Bun 347 文件成功退出；API 21 文件中 remote ingress、listen、QQ relay 三文件失败，因此入口按设计停止，build / smoke 未运行。全库 lint 仍为存量 195 errors / 1036 warnings。应用测试是发行源码的一部分，已按现有 prepare 流程从固定 bundle 继承历史追加候选版本，未推送或创建远程仓库。Web 页面制品与材料记录已经重建，保留完整字节与 digest 比较断言。

settings browser 原 fixture 在 blob ESM 内不能解析 `/pages.js`；改用真实 `deps.source` 对应的隔离同源 HTTP 页面脚本，仍禁止其他 origin 的请求。错误状态按当前应用实际返回断言（Pi 为设置无效，Notify 为 `Error: invalid`），增加持久设置仍为上一成功值的检查；不声称 Notify 已有中文错误文案。六个场景已实际复验通过，相关三文件 lint 无问题。

`.tmp/cleanup-and-reorg/bundle-history-check.json` 已逐个验证全部七个旧 commit 都是候选 commit 的祖先，且 bundle SHA256 与 lock 一致。当前应用源码与旧 bundle 已存在大量未同步差异，因此候选应用 diff 不仅包含本次 fixture 修复；Web 为 98 文件、Notify 14、Pi 12、QQ 14、Author 10、Mind 25、Chat 14。发行复验针对这个明确组合，不声称这些源码差异全部由本阶段新写。
