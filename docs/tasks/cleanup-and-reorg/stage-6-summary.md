# 阶段 6：职责与目录实施结果

状态：`applicable-gates-passed-combined-bun-coverage-awaiting-parent-review`。主仓库 HEAD `694f2d9d`，未暂存、未提交；九个独立应用仅本地 main 提交并 pin，无 push/部署。

224 文件按职责移入 kernel `agent/`、`execution/`、`modules/` 和宿主 `runtime/`、`packages/`。128 个生产文件 10,916 行、96 个测试/fixture 14,994 行属于搬迁，不能算功能删除。构建 415 行拆为材料检查/认领 220 行和审批/恢复 209 行；实现语句 token 保留证据不变。20 个资源/动态路径消费者同步。九应用的13个测试/支持文件已独立提交并固定，生产与生成字节不变。

| 分类 | 前文件/行 | 后文件/行 | 净行 |
| --- | ---: | ---: | ---: |
| 宿主生产手写 | 354 / 29533 | 355 / 29563 | +30 |
| 宿主测试/fixture | 300 / 38602 | 301 / 38690 | +88 |
| 宿主生成 | 1 / 185 | 1 / 185 | +0 |
| 应用生产手写 | 178 / 18012 | 178 / 18012 | +0 |
| 应用测试/fixture | 140 / 18011 | 140 / 18011 | +0 |
| 应用生成/制品 | 83 / 7343 | 83 / 7343 | +0 |

宿主生产 `+578/-548`，净 `+30`；测试 `+661/-573`，净 `+88`；生成净0。复审两修复切片生产+2、测试+29；本轮 fixture 补材料仅测试+1。搬迁、JSON/bundle/文档及本地 Prisma 52文件/84,851行生成输出分开计账。候选与保留理由见 stage-6-plan.md。

Bun 发现351→352，API21→21，映射后原测试缺失0。r3 full Bun 实际 exit **1**：352文件中351通过，唯一失败为 `scripts/application-git-inputs.bun.test.ts`（2 pass/15 fail），总计3608 pass/15 fail。原因是 fixture 复制 lint-ratchet.ts 漏带新 JSON。现仅同步复制真实 JSON，既有17测试/102断言定向通过。**351已通过文件 + 此文件17测试补验形成全发现范围组合覆盖，不宣称单轮full Bun全绿。** 未重跑无关full Bun。

同类消费者检查仅发现 application-git-inputs fixture 与专用 lint-ratchet fixture。后者已有有意义的 left/right→old 测试映射，无需补生产mapping。没有改断言、规则、阈值或使用空mapping。runner清除全部继承GIT_*；hook变量测试仍在自己的临时仓库设置所需变量。

两项原BLOCK已由独立 close review `847c97e5-177b-44b9-8df7-911e18bad309` 判定OK关闭：未使用导入已删，旧文件仍在目标树时不转移lint预算。r3完整slice四项通过、252关联文件通过；r2 slice lint失败及初轮compiled fixture三旧路径失败均保留。最终父复核仍需覆盖本轮一行fixture修复与整合证据。

| 本轮检查 | 实际退出/状态 | 日志 |
| --- | --- | --- |
| fixture-directed | 0 | `.tmp/cleanup-and-reorg/stage-6/r4-fixture-directed.log` |
| fixture-lint | 0 | `.tmp/cleanup-and-reorg/stage-6/r4-fixture-lint.log` |
| verify-slice | 0 | `.tmp/cleanup-and-reorg/stage-6/r4-verify-slice.log` |
| api-all | 0 | `.tmp/cleanup-and-reorg/stage-6/r4-api-all.log` |
| build | 0 | `.tmp/cleanup-and-reorg/stage-6/r4-build.log` |
| smoke | 0 | `.tmp/cleanup-and-reorg/stage-6/r4-smoke.log` |
| shell-browser | 0 | `.tmp/cleanup-and-reorg/stage-6/r4-shell-browser.log` |
| settings-browser | 0 | `.tmp/cleanup-and-reorg/stage-6/r4-settings-browser.log` |
| lint-debt | 1 | `.tmp/cleanup-and-reorg/stage-6/r4-lint-debt.log` |

全库lint债务盘点实际exit `1`：1226 problems / 193 errors / 1033 warnings。保留诊断失败；通过的ratchet证明本次无新增债务，未放宽规则。

本轮最终完整slice **253个关联测试文件通过**，typecheck零错误、ratchet零新增、guardrails（含boundaries）通过；API **21文件/131测试通过**。Web shell **60 checks**、Pi/Notify设置页 **6场景** 通过，均覆盖1440×900、1024×768、390×844，手机无横向滚动。native build与packaged smoke均exit0，release identity记录HEAD 694f2d9d + workingTree=modified，不是clean commit或部署验收。

不含真实模型/QQ/账号/数据库、部署、整机激活或完整Nix/Docker构建验收。
