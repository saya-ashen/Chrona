# 阶段 4 文件与测试迁移计划

基准 `c74a45db53b0880b61ba78c8c8433555fa0196c1`，开始时工作树干净。只写本隔离工作区、明确授权的同级应用本地仓库与最终报告；主仓库不暂存、不提交。原工作区不写。

## 源码与历史

13 个应用全部进入 `/home/saya/workspace/chrona-module-<name>`。七个发行应用 clone 现有受检 bundle 的 `main`，新提交保留祖先；六个保留应用保存真实源码、许可证、生成输入与适用测试后创建本地 `main`。不设置远端，不改变发行/暂停集合。

主仓库删除所有受跟踪 external 源码。固定的开发输入 lock 引用七个发行 bundle 与六个非发行 bundle；Git 未包含的 artifact 用精确固定输入单独保存，恢复后仍调用既有 material/source/artifact/mode 校验。恢复目录为 gitignored `packages/engine/src/modules/steward/applications/<name>`，保持原相对深度，只作固定输入展开，绝不读相邻仓库。相邻仓库是编辑/提交来源，不是主程序构建输入。

## 消费者与测试

- `build/manifest.ts`、builder、生成入口：使用固定 staging；Pi builder 必须由目标 staging 加载并用目标目录的 runtime/test 源构建。
- 应用生成副本仍应用私有，复用 entry-app 源与现有 SDK；Web settings 类型留应用侧，宿主模板通过现有应用类型消费。
- runtime / doctor 开发资源入口改为固定 staging；发行仍使用显式资源目录。删除 engine 对 QQ 的生产反向导出；停止服务 CLI 用 QQ 应用自有本地维护入口生成绑定码，数据格式保留应用所有权。
- Docker/Nix 携带固定 bundle/材料输入和恢复脚本；install、dev、test、typecheck、lint、guardrails、build 均具明确恢复入口。
- 所有原应用测试及支持源码整体随应用仓库保存；涉及真实 kernel/DB/跨应用的组合测试通过宿主固定 staging 执行，主仓库既有集成测试保留并更新路径。逐文件映射见 `stage-4-test-mapping.json`，包含 wrapper、浏览器入口和 fixture，不缩减发现覆盖。
- tsconfig / eslint / lint ratchet / boundaries / guardrails 路径同步。迁移后的 lint 按原文件路径基准比较，存量诊断不藏入白名单。

## 实施与验证顺序

1. 建立应用仓库及精确 artifact 输入，保存每个 ancestry/commit/bundle SHA 与逐文件映射。
2. 更新源码消费者、恢复入口、生成与发行构建；定向验证恢复、篡改拒绝、Pi 目标源与 QQ CLI 行为。
3. 证明无旧 external、无相邻 checkout 依赖；核对迁移前后测试发现集合，串行全量 `verify:slice`、完整 Bun/API、build/smoke 与必要浏览器三尺寸。
4. 所有重型检查使用 `MemoryMax=8G`、`MemorySwapMax=1G`、`NODE_OPTIONS=--max-old-space-size=6144`、`CHRONA_TEST_CONCURRENCY=2`、`LINT_RATCHET_BASE=6966a5c3` 并继承 PATH/PRISMA_SCHEMA_ENGINE_BINARY。日志在 `.tmp/cleanup-and-reorg/stage-4/`。
5. 保留既有 Pi retry 间歇失败证据；新增失败先诊断，不弱化断言。最后记录净增减行、组合身份的 dirty 状态与未覆盖范围，交父协调者独立审查。

当前子 agent 工具白名单没有 Serena/Hindsight/provider discovery，因此通过原生 rg、TypeScript 与实际调用方核对符号；不假称调用不可用工具。可用 ponytail 已读取，anti-slop 未在可用技能目录中提供；按用户 session override 保持简洁代码与现有视觉。

## 隔离构建后的批准收敛

隔离重建Pi依赖发现既有pino/thread-stream vendor内两处__dirname绝对路径会随构建根变化，导致强Git tree比较拒绝（其它runtime/test源输出一致）。协调者批准宿主组合消费已固定、完整验证的Pi artifacts，不在prepareReleaseModules重新assemble；缺失不重建、不降级。独立builder与pin维护链、目标builder回归和source/material/artifact/mode/Git tree严格校验保留。新增隔离包内实际logger写入、Pi runtime/假Provider测试入口及strace文件访问证据；已有绝对路径限制单列，不宣称修复跨根可重复重建。

Review B后补post-extraction Git bundle lint基线、并发首次恢复、fatal无条件拒绝及index固定输入一致性回归。普通lint债务按文件数量比较，不能描述为每条新增诊断均被识别。
