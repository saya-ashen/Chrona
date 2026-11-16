# 阶段 5：减法清理

基准 `21c63b8f`。本阶段仅清理主仓库内部的无消费者项目；没有修改应用仓库、固定输入、公开包导出或 `packages/contracts/src/steward/index.ts`。主仓库不暂存、不提交，独立 review 由父协调者执行。

## 删除依据

knip 的 JSON 报告用于发现候选，dependency-cruiser 用于检查引用图与边界。之后逐项检查基准 Git 树、当前源码及 gitignored 固定应用源码；未把 knip 的“生产图不可达”视为可以删除测试支撑代码的证据。完整引用记录在 `.tmp/cleanup-and-reorg/stage-5/removed-item-references.json`，文件级候选决策在同目录 `file-candidate-decisions.json`。

| 切片 | 删除内容 | 消费者查证与保留项 | 净行数 |
| --- | --- | --- | ---: |
| 旧内部查询包装 | `kernelExecutionPlacement`、`kernelExecutionLocations` 及专用 imports | 两符号在基准各仅有定义，固定应用源码零引用，不在 engine 包公开导出；保留 `startKernelExecution`、`kernelExecutionCleanup` 及其 principal/停止/回执检查。未改 `execution-v2-tools.ts` 的现有查询实现。 | -34 |
| 未消费投影与 schema | `store.toSession/toRun`、`modulesRollbackOutput/modulesStatusOutput`、`secretViewSchema` 及该文件的 zod import | 各符号仅有定义；审批仍调用 `toApproval`，系统工具使用既有 `publicSystemTools` 合同，凭据元数据仍由 `secretView` 生成。没有删除任何实际执行的输入/输出校验。 | -18 |
| 内部死转导出与别名 | `module-calls` 的三个转导出及 `systemOrigin`；`module-build` 两转导出；`agent-context.ownedContext` 转导出；`module-candidates.findCandidateSet` 转导出；`MODULE_EVOLUTION_KIND` | 保留所有原始定义与直接消费者；`checkSystemOutput`、`moduleCallbackContractHash`、`validateToolArgs`、`moduleToolExampleError` 等仍被测试通过旧内部路径使用的转导出保持不变。`ownedContext` 仍被同文件直接导入使用，所有身份检查保留。 | -6 |
| 未接入提示文本 | `run-instructions.ts` / `STEWARD_PROMPT` | 图中没有 dependents，基准符号仅定义，主树和固定应用源码没有路径/符号引用；删除不改变实际发送的 prompt。 | -2 |
| CLI 死依赖与锁闭包 | `chalk@6`、`cli-table3` 的 CLI 声明及其失去消费者的依赖 | 主树源码与固定应用源码没有 import/require/路径消费者；依赖由 Bun 离线更新锁，随后冻结安装验证。`chalk@4` 仍被 dependency-cruiser 的传递消费者使用并保留。锁中没有新增版本或 integrity，移除八种原有版本；其他 diff 是保留版本的去重和提升。 | -30 |
| 固定输出消费者同步 | `flake.nix` 的 `chronaNodeModules.outputHash` | 唯一 hash 替换同步锁闭包；实际旧 hash 构建失配，更新后构建 exit 0，store 中的 narHash 与声明一致；不改 Nix 构建流程。 | 0 |

合计生产 TypeScript（10 文件）**+6/-66，净 -60 行**；依赖声明与锁 **+6/-36，净 -30 行**；Nix 消费者 **+1/-1，净 0 行**；代码/依赖/Nix 合计 **+13/-103，净 -90 行**。没有移动文件、迁移删除或格式压缩；任务文档另计。

## 动态入口与保留理由

28 个 knip 文件候选中只删除 `run-instructions.ts`，保留 27 个：

- `module-sdk/preview.ts`、`testing.ts`、`module-typecheck/{calls,check,chrona-sdk-loader}.ts` 通过 `build/manifest.ts`、`runtimes.json` 和子进程路径交付/运行，静态 import 图不足以证明它们无用。
- `entry-app/kernel-client.ts`、`preferences.ts`、`memory-settings.tsx` 由 `build/entry-conversations.ts` / `build/application-pages.ts` 按路径读取，生成应用私有副本；固定输入和生成源均保留。
- `apps.ts`、`build-governance.ts`、`module-overview.ts`、`module-capabilities.ts`、`module-readiness.ts`、`system-apps.ts` 仍有测试消费者，保持现有断言和覆盖。
- 所有 fixture、测试 helper、`__testing__/state-machine-invariants.ts` 和暂停应用保留。`moduleDiagnosticsExamples` 是合成 fixture，不因无生产引用删除。
- `dependency-cruiser` 被 `scripts/chrona.ts` 和 guardrails 以命令形式调用，保留 devDependency；其他 workspace 依赖候选本阶段不动，避免把静态入口遗漏推广为包级依赖删除。
- 未删除活跃授权、预算、租约、停止、幂等、数据安全或恢复约束；没有引入持久化、catch、fallback、框架或额外依赖。

## 验证

定向 11 文件 **267 tests / 0 fail**，随后补验 `module-reference.bun.test.ts` **19 tests / 0 fail**。首次完整 slice 的 lint、guardrails 和 100 个关联测试文件通过，typecheck 因遗漏的真实测试消费者 `moduleCallbackContractHash` 转导出而失败；已恢复原转导出，随后完整 typecheck、native build、packaged smoke 全部 exit 0。原失败保存在 `results.json`，修复补验另存 `resume-results.json`，不覆盖成单次全绿。

依赖锁改变触及 `flake.nix` 的 `chronaNodeModules` 固定输出。经协调者决定，保留死依赖删除，并使用实际 FOD 构建重算/验证 hash。旧 hash 的构建真实 exit 1 并给出 mismatch；新 hash `sha256-LpYWxPx1Gylm6KnKZTAxHM4eBgO1WF3ZVRs0S2TMt/4=` 随后构建 exit 0，`nix path-info --json` 的 narHash 完全一致（400608384 bytes）。Nix parse exit 0；没有修改 flake.lock、构建步骤或系统配置。

完整 lint 当前 **195 errors / 1033 warnings / 0 fatal parsing**，其中应用仍为 **193 errors / 443 warnings**。规则及忽略项未变；ratchet 通过仅表示零新增。dependency-cruiser **0 errors / 48 warnings**。knip issues 113→109、文件候选 28→27、export 候选 137→122、依赖候选 9→7；剩余候选不按数字清理。

最终完整 `bun run verify:slice` 在 Nix 串行 unit 中 exit 0：lint ratchet、typecheck、guardrails/boundaries 通过，100 个关联测试文件通过。定向 11 文件与补验测试、native build、packaged smoke、Nix FOD 重算/实际构建也均有独立日志；旧 hash mismatch 的失败保留为证据。实际命令、时间、退出码与日志见 `.tmp/cleanup-and-reorg/stage-5/results.json`、`resume-results.json`、`nix-results.json`，最终 evidence 已刷新。

未新增或修改测试。删除项没有需要新增断言的新分支；使用既有测试验证保留下来的可观察行为。完整 Bun/API、浏览器、Docker/Nix 与部署是否执行，以最终 evidence 的覆盖记录为准。
