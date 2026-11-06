# 模块 Git 种子与官方发布

每个非系统应用独立仓库，共十一项：web、mcp、files、notify、events、qq、remind、mind、memory-local、coding、editor。系统模块不拆。官方 GitHub 名称是 `chrona-core/chrona-module-<name>`；仓库由 `saya-ashen` 创建后转移到 `chrona-core`，保留 repo ID、公开状态和提交历史；主 Chrona 仓库不转移。准确远端与发行 commit 见受版本控制的 `resources/module-git/lock.json`。

初次提取从当前构建输入源码创建 `Extract initial module release from Chrona <base commit>` 初始提交，说明中明确源码来自工作树，不声称继承主仓库子目录历史。作者固定为 Chrona Release，时间来自宿主 commit；不读取个人 Git identity。每模块随包 MIT License 原样复制自主仓库，保留 `Copyright (c) 2025 AgentDashboard Contributors`；不将引用的第三方依赖重新许可。SDK 仍由 Chrona 发行资源提供，独立源码仓库不是自带完整 SDK 的 npm 包。初始提取 commit 后追加 License 提交，保留原始 ancestry；web/coding/editor 再追加第三方通知提交；完整 bundle 包含全部提交。相同源码树复用现有种子的 commit；之后修改在该独立仓库历史上追加提交，不自动提交主仓库。

## 准备和审阅

默认构建复制资源后，生成 coding/editor 契约，统一给十一份 staging 模块复制 `resources/module-git/LICENSE`，并给含第三方 bundle 的 web/coding/editor 复制 `THIRD-PARTY-NOTICES.txt`，再消费固定种子。构建不会生成初始提交，也不依赖主仓库 `.git` 或宿主 commit 环境变量。

受版本控制的发行输入是 `resources/module-git/`：`lock.json`、十一份完整 `.bundle`、MIT `LICENSE`、`THIRD-PARTY-NOTICES.txt` 和不含本机路径的 `publish-plan.json`。默认构建、Docker、Nix 消费同一历史；`CHRONA_MODULE_GIT_SEEDS` 可显式覆盖种子目录，仍严格验证 checksum、commit 和源码 tree。

`dist/module-git/` 仅为显式维护种子的缓存，不作为默认构建输入：

- `repos/<name>.git`：十一份独立 bare repo，可供最终发布审阅。
- `<name>.bundle`：含完整 main 历史、无外部 prerequisite 的离线种子。
- `lock.json`：`{ version: 1, modules: [{ name, repository, branch, commit, bundle, bundleSha256 }] }`。
- `publish-plan.json`：拟议公开仓库名、本地 repo、branch、commit；与可信 lock 分开。

初次准备时 `repository: null`，表示源码尚未发布。离线种子可用不等于存在公开 upstream，不能承诺上游更新。

开发启动前显式准备发行资源（不编译二进制、不接触用户数据）；随后让源码进程使用该资源根。启动本身不会自动生成或联网：

```sh
bun scripts/build-binaries.ts --resources-only dist/module-resources
CHRONA_RESOURCE_DIR="$PWD/dist/module-resources/resources" bun run dev
```

维护已有发布历史时，先把固定 `lock.json` 和十一份 bundle 复制到维护目录；prepare 会在 bare 缓存缺失时从已校验 bundle 恢复 main，再追加提交。不得从空目录为已有公开模块重新提取 root。

维护者准备了 staging 资源根（含 builtin/ 与 external/，且先完成生成契约）后，可单独准备；prepare 自动使用主仓库 `LICENSE` 和固定发行目录的第三方通知，与正常构建共用同一 staging 规则：

```sh
bun scripts/module-git-release.ts prepare /absolute/path/to/seeds /absolute/path/to/staged/resources
```

仅显式 prepare 在无主仓库 `.git` 的维护环境需提供真实宿主基线 `CHRONA_MODULE_GIT_COMMIT`（40hex）与 `CHRONA_MODULE_GIT_TIMESTAMP`（Unix 秒）。它们是源码提取溯源，dirty 输入不声称等于该主仓库 commit。准备不创建 GitHub 仓库、不推送、不修改用户数据。

## 真实公开发布 gate

1. 审阅每份源码、license、生成契约、初始提交、publish-plan；确认没有凭据或个人数据，并确认全部模块可独立交付。
2. 获得具体发布授权后，由发布者创建真实公开仓库，将本地对应 main 历史推送到计划中的仓库。准备脚本不执行创建或推送。
3. 使用只读核验命令检查 GitHub visibility 和真实 main 指向，全部精确匹配 lock commit 后才写入真实 repository：

```sh
bun scripts/module-git-release.ts verify-published /absolute/path/to/seeds
```

核验需要发布者的 `gh` 和系统 Git；不读取或打印 token。任一未公开、未建立或 commit 不匹配则不更新 lock。该命令只接受上述计划中的十一项名称，不允许任意来源替换官方身份。

4. 将已核验的 `lock.json` 与十一份 bundle 同步进 `resources/module-git/`，保留主仓库 MIT License；不要版本控制 bare repos 或含本机路径的缓存 plan。正式构建默认消费它们，保留远端和离线 bundle 的同一提交历史；独立维护种子可显式覆盖：

```sh
CHRONA_MODULE_GIT_SEEDS=/absolute/path/to/seeds bun run build
```

构建逐项核对 bundle SHA256、完整性、main commit 和源码 tree；源码或生成契约不符时失败，不能静默创建另一条初始历史。以后官方更新先在真实独立仓库提交、更新固定种子，再交付主发行。修改生成 bundle 时，用相同 Bun 版本与参数的 metafile 核对实际依赖，更新第三方通知；第三方原始许可证和版权通知应完整保留。当前通知覆盖 web 的 React/React DOM/scheduler、json-render、zod，以及 coding/editor 生成契约的 zod；它们各自保留 MIT 或 Apache-2.0。

归档包含 `resources/module-git/{name}.bundle` 与 `lock.json`，bundle 在源码根之外，不混入 `.git`、依赖或数据。运行构建产物、安装依赖与数据备份仍按现有机制保留；Git 只替代重复源码副本。

## 系统 Git 依赖

所有安装均需 Chrona 进程 PATH 中存在系统 Git；`chrona doctor` 报告 Git 缺失，不自动安装、不要求个人 GitHub 账号。Git 缺失时源码操作明确失败，没有旧快照 fallback。

- Linux 裸二进制：通过发行版包管理器安装 `git` 与 HTTPS CA（例如 Debian/Ubuntu 的 `git ca-certificates`）。
- macOS 裸二进制：安装 Apple Command Line Tools 或包管理器的 Git，确认服务运行环境的 `git --version` 可用。
- Windows 裸二进制：安装 Git for Windows 并加入运行 Chrona 的 PATH；安装后重启服务进程。
- Docker runner 显式安装 Git 与 CA；源码构建直接复制受版本控制的固定种子，不需要宿主 Git 元数据 build args。

- Nix 包使用 wrapper 注入 Git PATH，NixOS、Home Manager 和直接 CLI 共用该运行依赖。Nix 构建也显式带 Git。

Git/种子校验成功不表示网络上的 upstream 此刻可达。离线安装使用 bundle；联网更新失败或发生冲突时，保留本地修改与当前运行版本，不自动覆盖、stash 或推送。
