# 阶段 5：有证据的减法清理

- 基准：`21c63b8f`；开始时主工作树及 index 干净。唯一写入者仅处理本阶段，主仓库不暂存、不提交。
- 先运行既有 knip 与 dependency-cruiser，报告只用于筛候选；用全仓引用、包 exports、构建/生成/CLI/测试入口和固定应用源码核对消费者。无法证明无消费者的项目保留。
- 优先主仓库内部死代码、未使用的内部导出、无价值包装或依赖；不改公开合同、可靠性边界、测试断言/覆盖、暂停应用、fixture、生成副本和 UI。不修改 `packages/contracts/src/steward/index.ts`。没有充分证据时不为净减数字制造变更。
- 逐切片记录删项、引用证据、动态入口保留理由与净行数；若确需修改应用则遵循独立仓库提交后 pin 流程，优先避免应用 churn。
- 检查先定向后完整 `bun run verify:slice`，重型命令串行运行于 MemoryMax=8G、MemorySwapMax=1G、NODE_OPTIONS=--max-old-space-size=6144，继承 PATH/PRISMA_SCHEMA_ENGINE_BINARY，CHRONA_TEST_CONCURRENCY=2。仅在实际影响需要时追加 API、全 Bun 或 build。
- 日志和临时结果置于 `.tmp/cleanup-and-reorg/stage-5/`；交付 `stage-5-summary.md`、`stage-5-evidence.json`，更新进度。独立 review 及主仓库提交交父协调者；不进入阶段 6。
- 工具能力：本 worker 无 Hindsight、Serena 或 antislop 专用工具；使用 rg、既有检查与源码核实。沿用 antislop during 的范围约束，不进行视觉或产品改版。
- 依赖切片发现 `flake.nix` 的 `chronaNodeModules` 使用固定 outputHash。协调者明确决定保留真实死依赖删除，并授权必要 Nix 构建与公开依赖下载以重算和实际验证 FOD；先结束现有重型验证再串行执行，不进行系统激活。更新 hash 后必须实际构建成功，不能只填 mismatch 的 got 值；最终完整 slice 覆盖最后修改。若环境阻塞或超时，留下实际失败或精确 unit/PID/log 供协调者接续。
