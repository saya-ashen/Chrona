[English](README.md) | 中文

# Chrona

Chrona 提供通用 kernel、宿主 runtime、CLI 和 SDK，供独立维护的应用使用。

kernel 负责应用生命周期、工具路由、真实调用方、审批、凭据、唯一 Run 队列、预算、取消及持久 timer。宿主提供本地进程执行与传输。CLI 启动 runtime、提供回环 HTTP kernel agent bridge，以及管理、诊断和备份命令。SDK 定义应用传输与构建合同。

具体应用源码、页面、Provider 适配器、依赖包和发行制品由各自仓库维护，应用自行构建、发布并说明安装方式。本仓库与发行包不含默认应用；全新 kernel 启动时创建数据库和默认 workspace，不安装应用，也不调用模型。

## 从源码运行

需要 **Bun ≥ 1.4.2**、**git** 及用于构建进程监管器的本机 C 编译器。完整备份还需要 GNU 兼容的 `tar`。

使用全新数据目录：

```bash
bun install
export CHRONA_DATA_DIR="$PWD/.data/kernel-fresh"
export DATABASE_URL="file:$CHRONA_DATA_DIR/chrona.db"
bun scripts/chrona.ts build helper
bun run dev
```

`bun run dev` 以 watch 模式启动 kernel runtime。不使用 watch 时执行 `bun run server:start`，打包发行使用 `chrona start --no-open`。HTTP bridge 默认监听 `127.0.0.1:3101`，`/health` 返回 runtime 健康状态。应用页面由单独安装的应用提供。

SQLite 默认位于 `<dataDir>/chrona.db`，可用 `DATABASE_URL` 覆盖。开发或运行多个实例时应显式指定 `CHRONA_DATA_DIR`。`CHRONA_CONFIG_FILE` 选择配置文件，格式见 [chrona.config.example.json](chrona.config.example.json)。

应用进程使用服务用户的 OS 权限。kernel 对路由动作实施授权、审批和预算，不将可信本地代码与宿主 OS 隔离。

## 构建与检查

```bash
bun run verify:slice
bun run build
bun run build:smoke
```

构建将 CLI/kernel、数据库迁移、SDK、runtime 声明和本机进程监管器打包至 `dist/releases/`。发行 smoke 检查打包 CLI，并用临时数据启动空 kernel，不需要应用、浏览器或模型。

应用在各自仓库构建和发行。根目录安装、lint、typecheck 和验证命令只处理本源码树，不恢复应用副本。

## 数据

执行 `chrona backup /absolute/private/path/backup.db` 或 `chrona restore /absolute/private/path/backup.db` 前须停止 runtime。数据库备份与配套归档须一起保存并保护隐私。备份内容和恢复限制见[运维说明](docs/zh/operations.md)。开发检查使用全新临时数据库，不为重构前数据库提供兼容迁移。

[文档](docs/README.md) · [kernel API](docs/zh/kernel-api-design.md) · [架构](docs/zh/architecture.md) · [贡献](CONTRIBUTING.md)

## 许可

[MIT](LICENSE)。
