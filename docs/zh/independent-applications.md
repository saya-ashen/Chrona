# 独立应用与固定开发输入

13 个官方应用的源码、许可证、构建输入、锁、材料与适用测试由独立 `chrona-module-<name>` 仓库维护。主仓库保留 kernel、宿主、SDK、应用私有副本的生成源，以及组合集成测试。应用仓库的存在不改变发行或暂停政策：发行仍为 web、notify、pi、qq、author、mind、chat，Remind 仍暂停，另六个保留应用不自动进入发行。

`resources/application-inputs/lock.json` 是开发组合的固定入口。七个发行 bundle 继续位于 `resources/module-git`，另六个 bundle 位于 `resources/application-inputs`。每项固定 commit、bundle SHA256、源码摘要；Git 中未包含的页面、Pi runtime/vendor 等 artifact 使用单独的精确输入，固定 SHA256，并由原 `chrona-material.json` 校验每个文件的字节、可执行模式与完整覆盖。没有通过校验的 checkout 不能作为发行资源。

`bun run applications:restore` 只从上述输入恢复 `.generated/applications/<name>`。该目录被 Git 忽略，是可删除重建的开发 staging；它保留原相对深度供既有组合测试使用。恢复入口不探测相邻应用仓库，也不访问远端。已经恢复的内容发生漂移时会明确失败；修改应进入独立仓库并更新固定输入。

正常 `bun install` 会恢复应用并按各自冻结锁安装开发依赖。已有依赖缓存时，可明确离线执行：

```sh
bun install --offline --frozen-lockfile --ignore-scripts
bun run applications:install --offline
bun run db:generate
bun run verify:slice
bun run test
bun run build
bun run build:smoke
```

应用恢复与 artifact 恢复不需要包缓存；包管理器依赖安装与主仓库原有依赖安装一样，需要冻结锁指定的依赖已在缓存中。发行构建消费固定 artifact 输入，不读取同级应用 checkout；Pi vendor 不在宿主组合阶段重建，缺失或不匹配时直接失败。独立 Pi 仓库仍保留 builder，更新须先构建、提交材料，再 pin。现有 vendor 的 thread-stream 仍含两处生成机绝对路径；本阶段以真实日志、离线 runtime/test 入口与文件访问追踪验收当前消费者，不宣称 vendor 全路径净化或跨目录字节可重复重建。Docker 复制相同输入与恢复脚本；Nix 的源码输入也携带这些受跟踪输入，不携带开发 staging。

修改一个应用时，先在其独立仓库中更新源码和适用制品、运行检查并提交本地 `main`，再明确指定仓库固定新输入：

```sh
bun scripts/pin-application.ts web /absolute/path/to/chrona-module-web
```

此入口要求源码已提交、Git 树与声明的源码完全一致、材料通过原校验；发行应用还必须继承当前发行 commit。它更新 bundle、开发 lock、精确 artifact 输入，以及适用的发行 lock。它不提交主仓库、不推送、不设置远端、不发布应用。更新后移走对应旧 staging，再运行恢复及适用组合检查。需要修改共享生成源时，应将生成结果落实为相关应用的新提交后再固定，发行构建仍逐字核对，不自动替应用创建历史。

应用纯逻辑测试归应用仓库；涉及真实 kernel、数据库、SDK 和跨应用行为的检查在宿主锁定组合中执行。Bun runner 明确发现恢复后的应用测试，三个 Chat 普通测试入口仍保留；API 与浏览器入口使用同一固定组合。当前发现入口为 `scripts/run-bun-tests.ts`、`scripts/run-api-tests.ts` 和 `scripts/verify-slice.ts`；阶段迁移时的逐文件映射从 Git 历史 `docs/tasks/cleanup-and-reorg/stage-4-*-mapping.json` 查阅。lint ratchet 在基线含固定输入 lock 时，从该 Git 基线的 bundle 读取应用源码；迁移前基线才回退旧 external 路径。普通 errors/warnings 按文件比较数量，不允许数量增加；fatal parsing error 一律失败，完整诊断仍输出。staged hooks 核对 index 中 lock、bundle、artifact 和 main commit，且要求对应工作树字节一致，防止只暂存 lock 的不完整组合。

CLI 的 QQ 绑定维护通过随发行交付的 QQ 应用 `bind-code.ts` 执行，绑定格式继续由应用拥有。主程序不再通过 engine 反向导出 QQ 业务代码；绑定码只在维护结果中返回，应用仍只保存摘要。
