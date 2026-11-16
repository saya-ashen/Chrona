# 阶段 2：当前应用与消费者

基准为阶段 1 提交 `48f1626`。机器清单 `application-inventory.json` 保存受跟踪文件、实际测试路径、固定发行 commit 和应用树外路径消费者。此阶段只盘点和纠正文档，不迁移源码或更改公开合同。

## 当前集合

应用源码仍在 `packages/engine/src/modules/steward/external/`，13 个应用、426 个受跟踪文件；有 97 个 `.bun.test`、4 个其他测试文件和 6 个 Web 浏览器入口。测试文件不等于独立执行：Remind 的普通 test 文件被 Bun wrapper 调用，Web 多数浏览器源码被 Bun 浏览器测试编译运行，Chat 三个普通测试已在阶段 1 接入 runner。

| 应用 | 跟踪文件 | 发行地位 | 历史 |
| --- | ---: | --- | --- |
| author | 17 | 默认 | 继承现有 bundle |
| chat | 46 | 默认 | 继承现有 bundle |
| events | 10 | 保留源码及离线检查 | 尚无固定 bundle |
| files | 10 | 保留源码及离线检查 | 尚无固定 bundle |
| mcp | 21 | 保留源码及离线检查 | 尚无固定 bundle |
| memory-local | 12 | 保留源码及离线检查 | 尚无固定 bundle |
| mind | 73 | 默认 | 继承现有 bundle |
| notify | 30 | 默认 | 继承现有 bundle |
| pi | 33 | 默认普通 Provider | 继承现有 bundle |
| qq | 29 | 随发行可选 | 继承现有 bundle |
| remind | 15 | 暂停，保留源码及离线检查 | 尚无固定 bundle |
| remote-execution | 17 | 保留源码及离线检查 | 尚无固定 bundle |
| web | 113 | 默认 | 继承现有 bundle |

默认名单同时核对 contracts 的 `PREINSTALLED_MODULE_NAMES` 和 `module-initialization.ts`；发行名单核对 `build/manifest.ts`。coding/coding-web 没有受跟踪源码，不为旧目录残留新建仓库。七个当前 lock 的 repository 全为 null；拟议仓库名不是已发布证据。

阶段 1 逐个核对 bundle SHA256、完整历史和旧 commit ancestry，成功构建并完成离线 packaged smoke。应用历史独立于 monorepo 路径历史；后续独立仓库应继承其自身 bundle，不重建七个根提交。其余六个保留应用需本地历史及离线输入，否则不能删除主树。

## 实际耦合及迁移验收

机器清单按 `steward/external`、`resources/external`、拆分的 `external` 路径和 externalRoot 扫描得到 102 文件 / 244 匹配行；包含文档和合成 fixture，属于路径候选而非 102 个运行时依赖。以下额外核对动态生成、Docker/Nix 和测试发现，不能只做字符串替换。

| 消费者 | 当前事实 | 剥离必须保留的行为 |
| --- | --- | --- |
| `build/manifest.ts`、`scripts/build-binaries.ts` | 复制旧 external，生成后验证固定种子，再裁剪暂停应用 | 离线固定输入，严格源码 tree / artifact digest / mode 校验；保留六个非发行应用开发输入 |
| `build/entry-conversations.ts` | 生成 pagination、kernel-client、会话、delivery、preferences、memory 及 redaction 私有副本 | 先去掉 logging 文本切片，明确源文件；生成副本继续属于应用 |
| `build/application-pages.ts`、`application-ui.ts` | 生成每应用私有 settings 源、builder 与 bundle | 共用 Web React runtime；类型与构建不依赖相邻 checkout |
| `build/agent-dependencies.ts`、Pi `build.ts` | Pi builder 从旧路径 import，入口取 import.meta.dir；vendor 依赖宿主 packages 和 lock | staging 本地 builder / 源码、固定依赖闭包，不能编译时偷读旧树 |
| `module-runtime.ts`、CLI doctor | 各有开发源码 fallback；发行使用显式资源根 | 迁移后开发和发行资源定位一致，不回退已删除旧树 |
| `engine/src/index.ts`、CLI `admin.ts` | CLI 直接导入 QQ bot 并写绑定码格式 | 应用持有 QQ 私有格式；不得移到 kernel 冒充剥离，需保存 stopped-service CLI 行为 |
| `engine/src/test-support.ts`、test-entry / test-activity-module | 真实应用源码与 manifest fixture | kernel 集成测试读取同一锁定组合，保留临时数据和真实 SDK 证据 |
| Author/MCP/Notify/Web/Pi 的宿主集成测试 | 一部分直接反向导入 kernel / db；Mind/Chat 跨应用测试 | 组合集成留主仓库；应用纯逻辑测试留各仓库，逐文件映射不能丢 |
| Web registration-test | 可生成独立 `.mjs` 测试 helper，Chat 已使用 | 复用既有导出方式，不复制整个 kernel 为新 SDK |
| `run-bun-tests.ts`、API runner、tsconfig、eslint、guardrails | 源码路径、发现前缀和生成排除写死旧树 | 新测试入口明确，保留覆盖、lint 债务比较与 guardrails 消费者 |
| Dockerfile、flake.nix | Docker COPY 与 Nix cleanSource 只看到主仓库固定输入 | 隐藏相邻应用仓库后仍能恢复、构建与安装；不依赖本机 reflink node_modules |

`chrona-material.json` 的 source 和 artifacts 分开：Git bundle 可能只含 source 与材料记录，**不保证带页面 bundle、Pi runtime/vendor 或 dist**。恢复 staging 后须从固定输入重建并逐字节核对 artifacts，或提供校验过的完整材料包；不能将 bundle checkout 当完整发行资源。

## 部署来源及尚待现场核对

现有正式能力为 `build-binaries`、release smoke、CLI 完整 backup/restore、受控 install/build/approve。复用这些入口，不新增并行打包或队列。

chino 历史线索在原目录 `.tmp/storage-release-20261116/`，仅作读取依据：当次导入独立 `declaration/chrona.nix`，从 `den.aspects.chino.nixos` 提取单服务单元；并非整机激活，也不证明当前运行主仓库 NixOS module。包通过 snapshot archive 导入，历史 archive 顶层名 `release` 与正式 `chrona-linux-x64` 不同；常规部署入口须明确布局，不能原样复制一次性脚本。

历史声明要求 trusted-local、Pi 版本、loopback 端口、独立 data/config、可写 runtime-resources、进程组实际停止和反代鉴权。线上应用可能包含当前不发行的 MCP，不能因此删除、更新或暂停。阶段 9 必须现场核对：实际进程 exe、service unit、资源根、活动应用精确 hash、未结算工作和未知停止、目标兼容性、完整停机备份、必要单服务权限。此阶段未连接远端、读取真实 DB/凭据或操作服务。

发布失败后的恢复保留当前数据，不在外部工作可能恢复后自动回滚旧快照。一次性 storage converter 不进入常规部署；当前任务不执行真实数据迁移。SSH、sudo、当前声明或兼容性缺口在需要现场动作时才视为硬阻塞，历史成功不授予新操作权限。

## 阶段验收

应用集合、源码归属、生成源、SDK、材料、运行 fallback、CLI、构建、测试、Docker/Nix 及部署来源已列明；源码仍未剥离。只改文档，复用阶段 1 已通过的完整门禁，不对相同源码无故重复运行 347 文件测试及构建。文档链接、清单计数和 JSON 解析另作最小检查。
