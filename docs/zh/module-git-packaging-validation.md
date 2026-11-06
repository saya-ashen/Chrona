# Module Git Docker / Nix 打包验证

2026-11-06，真实目录 `/home/saya/workspace/Chrona`，`platform-v2@55d3481c` 的本次未提交集成树；不是部署或公开发行声明。正式上游为 `https://github.com/chrona-core/chrona-module-<name>`。固定输入 `resources/module-git/` 共 15 文件：11 bundles、lock、MIT LICENSE、第三方声明、公开相对路径发布计划。构建消费固定历史，不依赖宿主 `.git` 或重造模块祖先。发行合同见 [Module Git 发行](module-git-release.md)。

## 最小改动

- Docker 安装 Git/CA，复制必要构建源码、固定 seed 和资源打包脚本，生成 `/app/resources`；`.dockerignore` 只放行所需 `build/*.ts`。
- Nix 增加构建 Git，包装器提供 Git/Bun/bash，避免依赖用户的开发 shell；依赖安装使用 `--frozen-lockfile`。
- Nix 首轮真实构建发现旧固定输出哈希失效；按实际内容更新为 `sha256-oKg+YNp5vYJdOd6kiiQ37JOmNqOZLrD/My4lDP3orVQ=`。新哈希对应缓存内容被后续实际构建复用，并未声称 Nix 重新执行了 frozen install。Docker 对同一源锁的 frozen install 实际通过；源 `bun.lock` 未修改。
- P 修复发行根目录许可复制，保留 11 模块 MIT 和 web/coding/editor 第三方声明原字节。S 修复同 DB/workspace 的重复首次注册，共享在途任务，保留身份、兼容性与 Git CAS 校验。

## 最终实测

| 检查 | 结果 |
| --- | --- |
| 两个打包脚本测试 | exit 0；6 pass、0 fail、157 assertions |
| S 内置注册定向入口及其关联测试 | exit 0；44 pass、2 个既有 bwrap skip、0 fail、247 assertions |
| Docker 构建 | exit 0；Bun 1.4.2、Git 2.47.3 |
| Docker bridge 冷启动 | exit 0；临时 SQLite、doctor、health、五内置模块 active 且有版本 hash |
| Nix Linux x64 构建 | exit 0；同最终 S 源码 |
| Nix 隔绝外部 PATH 启动 | exit 0；Git/doctor/health、五内置模块 active 且有版本 hash |
| 资源 | 11 个新组织地址及 bundle SHA256；根与 11 模块许可、3 份第三方声明字节匹配 |

最终 Docker image：`sha256:6150d7bb6a4f5a6a724ce4d55e8a480e31c3cccd0d230b5c40992553f624f9c4`。

最终 Nix store：`/nix/store/r8xaklvzs6zfchdv5lmnmy05b7r9121m-chrona-0.3.1`。

日志、逐阶段退出码、源码及 15 个固定输入 SHA256、诊断和清理回执位于 `/tmp/chrona-module-git/final-packaging/`。S 测试日志另见 `/tmp/chrona-module-git/S-builtin-tests.log`。完整脚本、失败轮次与最终轮次均保留；不表示全仓测试矩阵由 Q 重跑。

## 失败事实与边界

- Docker 完全断网时，基础 Git/资源/数据库/health 检查通过，但 web 首次初始化需安装已声明的 npm 依赖，五模块检查因 DNS 失败，exit 1。最终 bridge 容器允许该下载，无宿主目录挂载、无发布端口、无生产凭据；不宣称全新安装可完全离线初始化。
- 首轮 Nix 固定输出哈希错误、根目录许可遗漏、运行 PATH 缺 sh/Bun 的失败均保留。Git shim 诊断确认首次并发注册的 `update-ref ... 000...000` 因引用已存在而失败；S 修复后 Docker 完整检查通过。临时 shim 不进入源码或最终镜像。
- 最终 S 源码的 Nix 首次冷启动超过自设 60 秒观察窗口，exit 1，并留下安装进程。已精确停止该任务残留，未动系统 daemon。根据现有生产安装期限 600 秒，仅修正外部 smoke 观察预算，不改生产超时或断言；最终新私有 HOME 中缓存/包目录持续增长，46 秒后五模块全激活并正常关闭。
- Nix 既有 Bun override 与 xorg deprecation 警告未掩盖。未验证其他 CPU/OS、真实账户/Provider、安装到个人 profile、部署或完整离线初始化。

## 资源限制与收尾

重型工作始终串行。恢复后专用 Orca 终端 `term_e4b058c6-d513-413f-87db-457b45364691`，systemd user scope 客户端 MemoryMax 8GiB、MemorySwapMax 1GiB；宿主 Bun 固定 1.4.2。Nix daemon 不继承客户端内存上限，实际构建设置 `--max-jobs 1 --cores 1`，不将其描述为 daemon 内存限额。

任务专属 BuildKit `chrona-q-final-packaging` 实际 Memory 8589934592、MemorySwap 9663676416 字节（总量；允许 1GiB swap），max-parallelism 1。容器 smoke 使用相同限制和 `/data` tmpfs，无宿主用户卷、无发布端口；未访问个人 DB/profile、修改机器网络/Nix keys，未动 preview/Workbench。

任务 builder 移除 exit 0，任务容器为空；任务 scope 无进程。关闭前 shell 无活动后代，仅残留一个 shell 自身的 atuin zombie；终端 close 返回 ptyKilled true，list 确认新旧 Q handle 都消失。最终镜像和 Nix store 产物保留供复核。提交、推送与最终全矩阵验证由协调者/R 接续。
