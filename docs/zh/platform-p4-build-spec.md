# P4 规格补充：意图提案构建通道

状态：已实现（2026-10-21）；额度为暂定值。背景见 [platform-upgrade-plan](platform-upgrade-plan.md) §4.1、P4；前置契约见 [P4 规格](platform-p4-spec.md)。
本文件是构建通道的契约；实现与本文冲突时以本文为准。

## 1. 范围

做：Provider 只提交意图与示例，由 Chrona 发起独立的构建运行写出模块代码，再走现有网关（测试、连续性、模拟、审批）。

不做：独立模型或独立模型配置（构建运行与其他运行使用同一 Provider 配置）；网页上的额度设置；变形测试与独立审查（P5）。

## 2. 提交

`chrona_propose` 增加第二种形式，`dir` 与 `request` 二选一：

```ts
request: z.object({
  name: slug,                                   // 模块名；已存在则视为更新
  goal: text.max(4000),
  examples: z.array(text.max(1000)).max(10).default([]),
}).strict()
```

- 返回 `{ status: "build_queued", requestId, runId }`。
- 拒绝（`conflict`）：构建运行自身提交 `request`（不递归）；同一事务已有排队或运行中的构建；当日构建运行已达上限。
- 记 audit `module_build_request`（subjectId = requestId，details = affairId、name、goal、examples、intent）。

## 3. 构建运行

- 新 lane `build`：每工作区同时最多 1 个运行；与 foreground/background 互不阻塞；时限 `RUN_LIMITS.buildTimeoutMs` = 10 分钟。
- Run 的 `affairId` 为目标事务（计入事务每日运行上限），`cwd` 为 `<dataDir>/builds/<runId>/`。该目录只含：`request.json`；已有模块的当前激活版本源码 `current/`（若有）；上次尝试的公开报告 `previous-report.json`（若有）。沙箱只绑定该目录，看不到事务目录与对话。
- 无会话延续（`sessionId` 始终为空），不写回事务的 `sessionId`；不触发运行失败后的自动重试。
- 提示词为固定的构建说明 + `chrona_propose` 的模块格式说明；请求内容按 untrusted data 注入。
- 目录只暴露 `chrona_propose`；调用其他 Chrona 工具或模块工具 → `forbidden`。
- 在构建运行中 `chrona_propose` 只接受 `dir`（相对构建目录），`affairId` 固定为运行所属事务，来源记为 `build`，每次运行最多 3 次提交。每次提交记 audit `module_build_submission`（subjectId = versionId，details = requestId、runId）。

## 4. 结果与重试

- 构建成功 → 与现有提案相同：审批卡片，或在授权事务中按 P3 自动启用。
- 来源为 `build` 的版本被拒绝时不发起事务修复唤醒；若该请求的尝试次数 < `RUN_LIMITS.maxBuildAttempts`（3）且当日额度未满，排队下一次构建运行，并把公开报告（截断后的 stdout/stderr、清单错误）写入其 `previous-report.json`；否则发一条 `digest` 通知"模块 <name> 自动构建未成功"。
- 提交在生成版本前就被拒绝（清单无效、缺入口等）时记 audit `module_build_rejection`（subjectId = runId）；运行结束后若没有成功的版本，下一次尝试的公开报告取最近一次拒绝（版本测试报告或该同步拒绝）。
- 构建运行结束时没有任何提交（失败、超时或模型放弃）→ 同样计一次尝试，按上一条处理。

## 5. 额度（暂定）

| 项 | 值 |
|---|---|
| 每个请求的构建运行 | ≤ 3 |
| 每次构建运行的提交 | ≤ 3 |
| 每次构建运行时限 | 10 分钟；Chrona 工具调用沿用 60 次 |
| 每工作区每日构建运行（本地日） | ≤ 6 |
| 同一事务排队或运行中的构建 | ≤ 1 |

构建运行同时计入事务每日 24 次运行上限。

## 6. 契约与数据库

- `RUN_LANES` 增加 `build`；`RUN_TRIGGERS` 增加 `build`；`RUN_LIMITS` 增加 `buildTimeoutMs`、`maxBuildAttempts`、`maxBuildRunsPerDay`、`maxBuildSubmissionsPerRun`。
- `ModuleVersion.source` 可取 `build`（字符串列，无迁移）。

## 7. 验收（引擎层测试，假 Provider 与假沙箱）

1. 意图提案 → 构建运行在构建目录中启动，提示词含请求，目录只含 `chrona_propose`；事务目录不可见。
2. 构建运行提交的模块测试通过 → 审批卡片；来源为 `build`。
3. 测试失败 → 下一次构建运行带公开报告；第 3 次失败后只发通知，不再排队。
4. 没有提交就结束 → 计一次尝试；不触发通用运行重试；事务 `sessionId` 不变。
5. 递归提交、同事务重复构建、超出每日额度 → `conflict`。
6. 构建运行调用其他 Chrona 工具 → `forbidden`。
7. 现有 `dir` 提案与全部现有测试不受影响。
