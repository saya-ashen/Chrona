# 模块 Git 种子与官方发布

当前发行集合固定为 Pi、Web、Notify、Author、Mind、Chat、QQ 七个普通应用，默认预装前六个，QQ 按需安装。通用 Agent API 归 kernel，Pi 是可停用或移除的普通 Provider 应用。其他应用的源码与依赖材料可以保留在仓库，但不进入发行源码、Git 种子或默认初始化；Remind 仍暂停，Editor 已退役，见[退役记录](editor-retirement.md)。集合以 `build/manifest.ts` 为准；对应种子的来源与发行 commit 由同步后的 `resources/module-git/lock.json` 和 `publish-plan.json` 记录，不能用旧种子快照证明当前发行已完成验证。

2026-11-08 的历史盘点仅 files/events/remind 的 repository 非空，其余为 null；这是当时的锁定元数据，不能承诺当前提交均有公开 upstream。官方仓库命名约定为 `chrona-core/chrona-module-<name>`；离线种子、历史公开仓库与当前提交发布核验分别记录。后续收口见[统一开发路线](development-roadmap.md)。

初次提取从当前构建输入源码创建 `Extract initial module release from Chrona <base commit>` 初始提交，说明中明确源码来自工作树，不声称继承主仓库子目录历史。作者固定为 Chrona Release，时间来自宿主 commit；不读取个人 Git identity。每模块随包 MIT License 原样复制自主仓库，保留 `Copyright (c) 2025 AgentDashboard Contributors`；不将引用的第三方依赖重新许可。SDK 仍由 Chrona 发行资源提供，独立源码仓库不是自带完整 SDK 的 npm 包。历史初始提取 commit 后追加 License 提交，保留原始 ancestry；当时 web/coding/editor 再追加第三方通知提交。该历史不要求继续分发已退役 Editor 的 bundle；仍分发的完整 bundle 包含其全部提交。相同源码树复用现有种子的 commit；之后修改在该独立仓库历史上追加提交，不自动提交主仓库。

## 准备和审阅

默认构建复制资源后，生成当前入口会话材料和 Pi 依赖，给当前种子集合的 staging 模块复制 `resources/module-git/LICENSE`，并给含第三方 bundle 的模块复制 `THIRD-PARTY-NOTICES.txt`，再验证并复制固定种子。验证后按发行清单裁剪 staging 的 external 模块树，只保留上述七个应用；仓库中的其他源码树不受影响。构建不会生成初始提交，也不依赖主仓库 `.git` 或宿主 commit 环境变量。

受版本控制的发行输入是 `resources/module-git/`：`lock.json`、当前集合的完整 `.bundle`、MIT `LICENSE`、`THIRD-PARTY-NOTICES.txt` 和不含本机路径的 `publish-plan.json`。默认构建、Docker、Nix 消费同一历史；`CHRONA_MODULE_GIT_SEEDS` 可显式覆盖种子目录，仍严格验证 checksum、commit 和源码 tree。

`dist/module-git/` 仅为显式维护种子的缓存，不作为默认构建输入：

- `repos/<name>.git`：当前集合的独立 bare repo，可供最终发布审阅。
- `<name>.bundle`：含完整 main 历史、无外部 prerequisite 的离线种子。
- `lock.json`：`{ version: 1, modules: [{ name, repository, branch, commit, bundle, bundleSha256 }] }`。
- `publish-plan.json`：拟议公开仓库名、本地 repo、branch、commit；与可信 lock 分开。

初次准备时 `repository: null`，表示源码尚未发布。离线种子可用不等于存在公开 upstream，不能承诺上游更新。

安装当前随发行交付的七个官方应用时，宿主默认关联 `https://github.com/chrona-core/chrona-module-<name>` 的 `main`，无需用户再手工关联。发行 lock 的 `repository: null` 仍只表示该精确提交未完成公开发布核验；默认更新地址不把离线 commit 宣称为远端已发布版本。其他保留应用不会按名称猜测远端。

默认关联不联网、不自动更新或激活，也不覆盖所有者已有的远端选择；源码合并、检查、审批及停止守卫沿用既有流程。已有实例不会因启动而批量改写来源记录，线上应用代码也不会因主仓库迁移而被替换。

开发启动前显式准备发行资源（不编译二进制、不接触用户数据）；随后让源码进程使用该资源根。启动本身不会自动生成或联网：

```sh
bun scripts/build-binaries.ts --resources-only dist/module-resources
CHRONA_RESOURCE_DIR="$PWD/dist/module-resources/resources" bun run dev
```

维护已有发布历史时，先把固定 `lock.json` 和对应 bundle 复制到维护目录；prepare 会在 bare 缓存缺失时从已校验 bundle 恢复 main，再追加提交。不得从空目录为已有公开模块重新提取 root。

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

核验需要发布者的 `gh` 和系统 Git；不读取或打印 token。任一未公开、未建立或 commit 不匹配则不更新 lock。该命令只接受当前官方计划中的模块名称，不允许任意来源替换官方身份。

4. 将已核验的 `lock.json` 与对应 bundle 同步进 `resources/module-git/`，保留主仓库 MIT License；不要版本控制 bare repos 或含本机路径的缓存 plan。正式构建默认消费它们，保留远端和离线 bundle 的同一提交历史；独立维护种子可显式覆盖：

```sh
CHRONA_MODULE_GIT_SEEDS=/absolute/path/to/seeds bun run build
```

构建逐项核对 bundle SHA256、完整性、main commit 和源码 tree；源码或生成契约不符时失败，不能静默创建另一条初始历史。以后官方更新先在真实独立仓库提交、更新固定种子，再交付主发行。修改生成 bundle 时，用相同 Bun 版本与参数的 metafile 核对实际依赖，更新第三方通知；第三方原始许可证和版权通知应完整保留。仍分发模块的第三方通知需覆盖其实际依赖，包括 Web 的 React/React DOM/scheduler；各依赖保留原许可证。退役 Editor 的历史通知不构成继续打包该应用的理由。

归档包含 `resources/module-git/{name}.bundle` 与 `lock.json`，bundle 在源码根之外，不混入 `.git`、依赖或数据。运行构建产物、安装依赖与数据备份仍按现有机制保留；Git 只替代重复源码副本。

## 系统 Git 依赖

所有安装均需 Chrona 进程 PATH 中存在系统 Git；`chrona doctor` 报告 Git 缺失，不自动安装、不要求个人 GitHub 账号。Git 缺失时源码操作明确失败，没有旧快照 fallback。

- Linux 裸二进制：通过发行版包管理器安装 `git` 与 HTTPS CA（例如 Debian/Ubuntu 的 `git ca-certificates`）。
- macOS 裸二进制：安装 Apple Command Line Tools 或包管理器的 Git，确认服务运行环境的 `git --version` 可用。
- Windows 裸二进制：安装 Git for Windows 并加入运行 Chrona 的 PATH；安装后重启服务进程。
- Docker runner 显式安装 Git 与 CA；源码构建直接复制受版本控制的固定种子，不需要宿主 Git 元数据 build args。

- Nix 包使用 wrapper 注入 Git PATH，NixOS、Home Manager 和直接 CLI 共用该运行依赖。Nix 构建也显式带 Git。

Git/种子校验成功不表示网络上的 upstream 此刻可达。离线安装使用 bundle；联网更新失败或发生冲突时，保留本地修改与当前运行版本，不自动覆盖、stash 或推送。
