# v2-6 规格：模块的软件依赖

状态：已在 `platform-v2` 分支实现（2026-10-23），与本文的差异见 §8。总纲见 [platform-v2](platform-v2.md)；依赖 [v2-1](platform-v2-1-runtime.md)。实现顺序：v2-1 完成后即可做，与 v2-2 至 v2-5 无依赖。
本文件是该部分的契约；实现与本文冲突时以本文为准。

## 1. 原则

- 模块可以使用现成软件，不必重写。构建 Agent 的提示词明确要求：优先使用成熟软件。
- 第三方软件与模块代码在同一沙箱、同一能力声明下运行，不额外放权。
- 用户 2026-10-22 决定"对症下药"：按主机类型采用不同的安装方式，不追求统一的跨平台包管理器（conda-forge 不全，nix-portable 不可用）。

## 2. 两类依赖

| 类型 | 声明 | 安装位置 |
|---|---|---|
| 语言库（npm、pip） | 模块目录内的声明文件加锁文件：`package.json` + `bun.lock`；`pyproject.toml` + `uv.lock`。由构建 Agent 生成并随代码提交 | 构建时由 Chrona 只按锁文件安装进模块目录（`bun install --frozen-lockfile --ignore-scripts`；`uv sync --frozen`），不重新解析版本；随版本按内容 hash 存储，回滚一起回滚 |
| 系统程序（ffmpeg、pandoc……） | 清单 `packages: ["ffmpeg", "pandoc"]`，名称按主机后端解释（§3） | 按主机后端 |

锁文件是必需的：声明文件只写版本范围，没有锁文件就无法保证同一模块版本在任何时候装出同一套依赖。`uv` 由 `nix` 后端提供；`system` 后端缺 `uv` 时按缺失系统程序处理（§3.2）。

## 3. 主机后端

Chrona 启动时检测后端，写入设置并在网页可见；构建 Agent 的提示词告知当前后端。

### 3.1 `nix`：有 Nix 的机器（NixOS 或已安装 Nix）

- `packages` 为 nixpkgs 属性名。Chrona 用固定的 nixpkgs 版本（设置项，默认取 Chrona 自身 flake.lock 中的版本）构建，得到 `/nix/store` 路径。
- 在 `<dataDir>/platform/gcroots/` 为每个模块版本建 GC root，防止被垃圾回收；版本删除时移除。
- store 路径写入版本锁；模块沙箱 `PATH` 只加入这些路径的 `bin`。
- 回滚时程序版本随之回到旧 store 路径。
- 没有 Nix、但用户愿意安装的机器：网页提示安装方法，由用户安装后切换为 `nix` 后端。Chrona 不自动安装 Nix。

### 3.2 `system`：其他 Linux

- `packages` 为该发行版包管理器的包名（构建 Agent 按检测到的包管理器填写：apt、dnf、pacman、zypper……）。
- Chrona 不以 root 运行，也不执行 `sudo`。缺少的包生成一条 `install_packages` 审批：卡片显示确切命令（例如 `sudo apt install ffmpeg pandoc`），由用户在主机上执行后点"已安装"；Chrona 复查程序存在后继续构建。
- 不需要 root 的安装方式（用户目录下的静态二进制、`pipx` 等）可由 Provider 经已授权的本机路径（`chrona_request_path_access`）完成，同样先经审批。
- 模块沙箱本就只读可见主机 `/usr` 等目录；`PATH` 包含系统路径。
- 版本不受 Chrona 控制：构建报告记录检测到的版本（如 `ffmpeg -version` 首行），回滚不回退系统程序；系统升级后模块行为可能变化。

### 3.3 `windows`

- 安装完全由 AI 管理：Provider 按需下载、安装（winget、官方安装包或便携版），每次安装经审批，卡片显示来源与命令。
- Windows 上没有 bwrap，模块未隔离运行（v2-1 §2.2），模块新版本逐版审批。

## 4. 审查与启用

- 审批卡片列出系统程序与语言库（名称、版本、来源）；不展示库源码。
- 新增或变更依赖视同新增能力：不自动启用。
- 构建与试启动在依赖就绪后进行；依赖缺失时构建暂停在 `install_packages` 审批，不计入构建失败次数。

## 5. 构建 Agent

- 提示词加入：当前后端；`packages` 写法；"优先使用成熟软件"。
- 构建目录提供已解析好的依赖环境，使其自测与 Chrona 构建检查一致（v2-1c）。

## 6. 验收

1. `nix` 后端：声明 `ffmpeg` 的模块构建后，沙箱内 `ffmpeg -version` 可用；GC root 存在；回滚到声明另一版本 nixpkgs 的旧版本时，使用旧 store 路径。
2. `system` 后端：缺少 `pandoc` 时生成带确切命令的审批；用户安装并确认后构建继续；构建报告记录版本。
3. npm 依赖：锁文件安装进模块目录，安装脚本未执行；回滚后依赖随版本回退。
4. 新增依赖的更新不自动启用。

## 7. 未决问题

- Windows 模块运行时的沙箱方案。
- `system` 后端下，系统程序升级导致模块失效时如何发现（是否定期试启动）。
- NixOS 上带原生代码的 pip / npm 包（manylinux wheel 等）需要标准动态链接器，是否在沙箱内用 Nix 提供。

## 8. 实现说明（2026-10-23）

- 安装器在内核侧（`module-packages.ts`），构建时、测试与试启动之前把依赖装进 staging 副本，随版本 hash 进入 store；提交中的 `node_modules`、`.venv`、`.chrona` 一律忽略，也不计入 hash 与代码 diff。安装命令只拿到 `PATH`/`HOME`/`LANG`/`NIX_*` 等工具链变量，不拿 Chrona 的密钥。
- `nix` 后端：`nix build <CHRONA_NIXPKGS>#<名称> --out-link <dataDir>/platform/gcroots/<hash>/<名称>`；`CHRONA_NIXPKGS` 未设置时用 flake 注册表里的 `nixpkgs`（不固定，部署时应设为系统的 nixpkgs，例如 `path:${pkgs.path}`）。store 路径的 `bin` 记在 `.chrona/packages.json`，运行时加到 `PATH` 最前；回滚随版本回到旧路径。被拒绝的版本删除其 GC root；已批准版本的 GC root 暂不清理（目前也没有删除版本的操作）。
- `system` 后端：**没有做 `install_packages` 审批**。缺少的程序让构建以错误拒绝，错误里带检测到的包管理器的安装命令（如 `sudo apt install pandoc`）；用户装好后重新提交即可。按程序名检查（包名与程序名不同的包需要写程序名）。
- Python：`uv sync --frozen --python <主机 python3> --no-python-downloads`，模块用 `.venv/bin/python` 运行。
- 依赖变化（`packages` 新增、`package.json`/`bun.lock`/`pyproject.toml`/`uv.lock` 任一变化）不自动启用；审批卡列出系统程序与语言库种类。
- 后端写在构建 Agent 的提示词里；网页上还没有显示。Windows 未处理。
- 修了一个相关问题：模块的 shell 由 Bun 以 socket 作 stdin 启动，bash 会因此读取 `~/.bashrc`，覆盖 `PATH` 并带入用户的 shell 环境；现在模块进程以 `SHLVL=1` 启动避免这一点。
