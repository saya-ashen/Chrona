# 内核瘦身阶段 1：开发检查记录

日期：2026-11-08。分支：`platform-v2`。对应[实施方案](kernel-minimization-plan.md)阶段 1。

**状态：阶段 1 开发检查通过。** 未推送、部署，未导出或删除真实用户数据。此记录不表示其余阶段或真实数据清理已完成。

## 改动范围

- 删除已不在生产注册表中的 `system/chat.ts`、`system/provider.ts`、`system/executions.ts` 及只验证旧入口的测试。
- 仍有价值的执行权限、参数、隐私和清理边界测试迁到 `agent.run/placement/locations/cleanup/get`。现行 Web 会话页面和 Agent 应用接口保留。
- 将内存 Provider 和注入式 Agent 原语移到 `test-provider.ts`、`agent-injected.fixtures.ts`，由 `testDb` 安装。真实 Agent 应用测试关闭这一替身；Neovim 测试生成的假 Pi 宿主显式安装。
- 生产 `local-provider.ts` 只保留实际使用的回调桥及真实 Agent 调用者校验；生产 runtime、注册表装配和 engine 发布入口不再导入或安装上述替身。
- 删除无消费者的确定性 E2E Provider 及通过环境变量选择它的生产分支；测试仍可通过 `RuntimeOptions.provider` 明确注入 Provider。增加环境变量不能启用测试 Provider 的回归断言。
- 移除旧 `wake_provider` 测试协议、旧入口占位及“AI 审批评估”描述。未变更 `modules.system` 的实现或生产注册集合。

## 用户批准补修的既有门禁

最初全量检查发现以下失败，在未修改的 HEAD 快照与独立数据库中复现。用户随后明确选择先修复这些门禁，再进入阶段 2。

### 执行目录与实际退出观察器

- 既有实现与 `ea1601de`、工作台文档一致：普通本地对话允许同目录独立运行，以 `heldDirectory = execution:<runId>` 跟踪未确认停止的执行，不锁共享项目目录。修正旧测试的项目路径及 v1/v2 互斥断言；v2 受管理工作空间的原有锁不变。
- 取消用例仍验证：同一执行在实际退出前不能继续，应用暂停、哈希变更、移除仍被未停止执行阻止。
- Neovim 超时的根因是测试观察器在释放前读取旧 `execution-changes.json`，而生产已写 `execution-changes-<attemptId>.json`。观察器抛错使整个收尾事务回滚，并非 Provider 未退出。仅修正测试路径，保留释放前快照断言；未改动生产停止确认、capture 顺序或目录释放机制。

### lint 基线

- Agent context 按只读访问、事务内 receipt reconciliation、提交后 effects 分开；保留同一事务及原有锁与幂等边界。
- Execution admission 分离创建、现有引用读取和控制传输；合并 Agent context/execution 的重复控制步骤，保持 context settle 与 execution 返回值差异。
- 入口会话按 journal IO、启动/刷新、重复请求恢复、补充消息与新 turn 入队拆分。补充消息仍先持久化 pending，再调用 Agent，成功才写 accepted；unknown 不重发。
- 修正磁盘 JSON 校验前过早的 `State` 类型断言；QQ deliveries 表示稀疏映射，不删除边界校验。
- 通过原有构建生成器同步 web/mcp/qq 私有副本，未增加运行时跨发布模块 import。Coding adapter 合并已有别名并分离私有 registry 列表；history 按四类只读资源拆分，未改变可见性。
- 未禁用 lint 规则或放宽门禁。默认 lint 保留 `packages/cli/src/doctor.ts` 原有、未增加的复杂度告警；ratchet 通过。

## 最终验证

Bun 1.4.2；重检查串行，`MemoryMax=8G`、`MemorySwapMax=1G`、`NODE_OPTIONS=--max-old-space-size=6144`。全量测试按文件隔离、`CHRONA_TEST_CONCURRENCY=1`，只使用测试数据库。

| 检查 | 结果 |
| --- | --- |
| `bun run typecheck` | 通过 |
| 默认 `bun run lint`（相对 `origin/main`） | 通过；未提高原有 lint 债务 |
| `bun run test:bun` | 154 文件，1540 通过，0 失败 |
| `bun run test:api` | 19 文件，71 通过，0 失败 |
| 新增两个 fixture 单独 ESLint | 通过 |
| 入口会话 owner 与三个生成副本一致性 | 通过 |
| `git diff --check` | 通过 |

定向回归另包含执行 v2 8/8、runtime 10/10、server workspace 9/9、workbench 4/4、Neovim 2/2（191 次断言）。最终全量在 baseline 修复和会话重排后执行，不沿用修复前的通过结论。

## 边界与证据

- 未调用真实模型或 QQ，未迁移真实数据，未操作线上数据库。
- Web 仅改一处说明文字和测试占位；未执行真实浏览器验收，不据此宣称后续页面改造已验收。
- 本地最终日志：`.tmp/kernel-minimization/stage1-typecheck-baseline-fixed.log`、`stage1-lint-baseline-fixed.log`、`stage1-test-bun-baseline-fixed.log`、`stage1-test-api-baseline-fixed.log`、`stage1-neovim-fixed.log`。
- 同目录的 `stage1-baseline-execution.log`、`stage1-baseline-neovim.log` 保留初始未修改 HEAD 的失败证据；快照仅作基线复现，不是新的实现分支。
